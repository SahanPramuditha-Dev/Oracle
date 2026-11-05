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
