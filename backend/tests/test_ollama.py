import httpx
import pytest
from fastapi.testclient import TestClient
from app.gemini import ProviderError
from app.ollama import Ollama
from app.main import create_app

AUTH = {'Authorization': 'Bearer test-credential'}


class FakeOllama:
    model = 'qwen2.5:1.5b'

    def __init__(self, error=None):
        self.calls = []
        self.error = error

    async def answer(self, text, history):
        self.calls.append((text, history))
        if self.error:
            raise self.error
        return 'Local assistant answer'


def test_ollama_local_processing_is_disclosed():
    provider = FakeOllama()
    with TestClient(create_app(token='test-credential', ollama=provider)) as client:
        data = client.get('/api/v1/capabilities', headers=AUTH).json()
        assert not data['cloud_requests']
        assert data['model']['processing'] == 'local'
        assert data['model']['provider'] == 'Ollama'
        assert data['model']['name'] == 'qwen2.5:1.5b'

        response = client.post('/api/v1/chat', headers=AUTH, json={
            'text': 'Hi local model',
            'history': [{'role': 'user', 'text': 'Hello'}, {'role': 'model', 'text': 'Hi'}]
        })
        assert response.status_code == 200
        assert response.json()['message'] == 'Local assistant answer'
        assert response.json()['provider'] == 'Ollama'
        assert response.json()['processing'] == 'local'
        assert len(provider.calls) == 1
        assert provider.calls[0][0] == 'Hi local model'


def test_ollama_error_handling():
    provider = FakeOllama(ProviderError(502, 'provider_connection', 'Could not connect'))
    with TestClient(create_app(token='test-credential', ollama=provider)) as client:
        response = client.post('/api/v1/chat', headers=AUTH, json={'text': 'Test'})
        assert response.status_code == 502
        assert response.json()['code'] == 'provider_connection'


def test_ollama_precedence_or_toggle(monkeypatch):
    from app.gemini import Gemini
    fake_ollama = FakeOllama()
    fake_gemini = FakeOllama()
    fake_gemini.model = 'gemini-test'

    # Default without AI_PROVIDER prefers local Ollama
    with TestClient(create_app(token='test-credential', gemini=fake_gemini, ollama=fake_ollama)) as client:
        data = client.get('/api/v1/capabilities', headers=AUTH).json()
        assert data['model']['provider'] == 'Ollama'

    # With AI_PROVIDER=gemini, switches to Gemini
    monkeypatch.setenv('AI_PROVIDER', 'gemini')
    with TestClient(create_app(token='test-credential', gemini=fake_gemini, ollama=fake_ollama)) as client:
        data = client.get('/api/v1/capabilities', headers=AUTH).json()
        assert data['model']['provider'] == 'Gemini'

class StreamingOllama(FakeOllama):
    async def answer_stream(self, text, history):
        yield 'Hello '
        if self.error:
            raise self.error
        yield 'there.'


def test_chat_stream_tokens_and_completion():
    import json
    with TestClient(create_app(token='test-credential', ollama=StreamingOllama())) as client:
        response = client.post('/api/v1/chat?stream=true', headers=AUTH, json={'text': 'Hi'})
        assert response.status_code == 200
        assert response.headers['content-type'].startswith('application/x-ndjson')
        events = [json.loads(line) for line in response.text.splitlines()]
        assert ''.join(event.get('delta', '') for event in events) == 'Hello there.'
        assert events[-1]['done'] is True
        assert events[-1]['processing'] == 'local'


def test_chat_stream_reports_failure_without_completion():
    import json
    provider = StreamingOllama(ProviderError(502, 'provider_connection', 'Connection interrupted'))
    with TestClient(create_app(token='test-credential', ollama=provider)) as client:
        response = client.post('/api/v1/chat?stream=true', headers=AUTH, json={'text': 'Hi'})
        events = [json.loads(line) for line in response.text.splitlines()]
        assert events[-1] == {'error': 'Connection interrupted'}
        assert not any(event.get('done') for event in events)


def test_capability_reply_does_not_invent_unavailable_tools():
    with TestClient(create_app(token='test-credential', ollama=FakeOllama())) as client:
        response = client.post('/api/v1/chat?stream=true', headers=AUTH, json={'text': 'What can you do?'})
        data = response.json()
        assert 'image' not in data['suggestions']
        assert 'sending emails' not in data['message']
        assert 'research' in data['suggestions']


def test_ollama_model_endpoints():
    class MockOllama(FakeOllama):
        def update_model(self, model):
            self.model = model

        async def list_models(self):
            return [
                {
                    'name': 'qwen3:1.7b',
                    'size': 1359293444,
                    'details': {'parameter_size': '2.0B', 'quantization_level': 'Q4_K_M'},
                    'capabilities': ['completion', 'thinking']
                },
                {
                    'name': 'qwen2.5:1.5b',
                    'size': 986061892,
                    'details': {'parameter_size': '1.5B', 'quantization_level': 'Q4_K_M'},
                    'capabilities': ['completion', 'tools']
                }
            ]

    provider = MockOllama()
    with TestClient(create_app(token='test-credential', ollama=provider)) as client:
        res = client.get('/api/v1/models/ollama', headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data['active'] == 'qwen2.5:1.5b'
        assert len(data['models']) == 2
        assert data['models'][0]['value'] == 'qwen3:1.7b'
        assert data['models'][0]['badge'] == 'THINKING'

        # Switch model
        post_res = client.post('/api/v1/models/ollama', headers=AUTH, json={'model': 'qwen3:1.7b'})
        assert post_res.status_code == 200
        assert post_res.json()['active'] == 'qwen3:1.7b'
        assert provider.model == 'qwen3:1.7b'

        # Capabilities now reflects updated model
        cap_res = client.get('/api/v1/capabilities', headers=AUTH)
        assert cap_res.json()['model']['name'] == 'qwen3:1.7b'
