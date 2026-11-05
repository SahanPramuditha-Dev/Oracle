import httpx
import pytest
from fastapi.testclient import TestClient
from app.gemini import Gemini, ProviderError
from app.main import create_app

AUTH = {'Authorization': 'Bearer test-credential'}


class FakeGemini:
    model = 'gemini-test'

    def __init__(self, error=None):
        self.calls = []
        self.error = error

    async def answer(self, text, history):
        self.calls.append((text, history))
        if self.error:
            raise self.error
        return 'A test answer'


def test_cloud_is_disclosed_and_response_uses_provider():
    provider = FakeGemini()
    with TestClient(create_app(token='test-credential', gemini=provider)) as client:
        data = client.get('/api/v1/capabilities', headers=AUTH).json()
        assert data['cloud_requests'] and data['model']['processing'] == 'cloud'
        response = client.post('/api/v1/chat', headers=AUTH, json={
            'text': 'Follow up', 'history': [{'role': 'user', 'text': 'Hello'}, {'role': 'model', 'text': 'Hi'}]})
        assert response.status_code == 200
        assert response.json()['message'] == 'A test answer'
        assert len(provider.calls[0][1]) == 2


def test_unauthorized_requests_never_reach_provider():
    provider = FakeGemini()
    with TestClient(create_app(token='test-credential', gemini=provider)) as client:
        assert client.post('/api/v1/chat', json={'text': 'Hello'}).status_code == 401
    assert not provider.calls


def test_context_limit_applies_before_cloud_request():
    provider = FakeGemini()
    with TestClient(create_app(token='test-credential', gemini=provider)) as client:
        response = client.post('/api/v1/chat', headers=AUTH, json={
            'text': 'x' * 4000, 'history': [{'role': 'user', 'text': 'y' * 4000}] * 4})
        assert response.status_code == 422
    assert not provider.calls


def test_provider_failure_is_not_a_successful_assistant_reply():
    provider = FakeGemini(ProviderError(429, 'provider_quota', 'Quota reached'))
    with TestClient(create_app(token='test-credential', gemini=provider)) as client:
        response = client.post('/api/v1/chat', headers=AUTH, json={'text': 'Hello'})
        assert response.status_code == 429
        assert response.json()['code'] == 'provider_quota'


def test_local_request_cap_stops_calls():
    provider = FakeGemini()
    with TestClient(create_app(token='test-credential', gemini=provider)) as client:
        for _ in range(50):
            assert client.post('/api/v1/chat', headers=AUTH, json={'text': 'Hello'}).status_code == 200
        assert client.post('/api/v1/chat', headers=AUTH, json={'text': 'Hello'}).status_code == 429
    assert len(provider.calls) == 50


def test_request_context_is_not_shared_between_sessions():
    provider = FakeGemini()
    with TestClient(create_app(token='test-credential', gemini=provider)) as client:
        client.post('/api/v1/chat', headers=AUTH, json={'text': 'session one', 'history': [{'role': 'user', 'text': 'first-session context'}]})
        client.post('/api/v1/chat', headers=AUTH, json={'text': 'session two'})
    assert provider.calls[1][1] == []


def test_adapter_merges_adjacent_model_and_tool_context(monkeypatch):
    import asyncio
    import json
    from app.main import HistoryItem
    original_client = httpx.AsyncClient
    captured = []
    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': 'Grounded answer'}]}}]})
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr('app.gemini.httpx.AsyncClient', lambda **kwargs: original_client(transport=transport, **kwargs))
    result = asyncio.run(Gemini('test-key').answer('Did it launch?', [HistoryItem(role='user', text='open sample'), HistoryItem(role='model', text='Please confirm.'), HistoryItem(role='model', text='Local desktop action result: Launch requested.')]))
    assert result == 'Grounded answer'
    assert [item['role'] for item in captured[0]['contents']] == ['user', 'model', 'user']
    assert len(captured[0]['contents'][1]['parts']) == 2


def test_adapter_uses_header_key_and_extracts_text(monkeypatch):
    original_client = httpx.AsyncClient
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': 'Hello from Gemini'}]}}]})

    monkeypatch.setattr('app.gemini.httpx.AsyncClient', lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs))
    import asyncio
    answer = asyncio.run(Gemini('test-provider-secret').answer('Hi', []))
    assert answer == 'Hello from Gemini'
    assert requests[0].headers['x-goog-api-key'] == 'test-provider-secret'
    assert 'test-provider-secret' not in str(requests[0].url)


@pytest.mark.parametrize('status,code', [(403, 'provider_access'), (404, 'model_unavailable'), (429, 'provider_quota'), (500, 'provider_error')])
def test_adapter_redacts_provider_errors_without_retries(monkeypatch, status, code):
    original_client = httpx.AsyncClient
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'message': 'secret-provider-debug-text'}})

    monkeypatch.setattr('app.gemini.httpx.AsyncClient', lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs))
    import asyncio
    with pytest.raises(ProviderError) as result:
        asyncio.run(Gemini('test-provider-secret').answer('Hi', []))
    assert result.value.code == code
    assert 'secret' not in result.value.message
    assert len(calls) == 1
