import pytest
from fastapi.testclient import TestClient
from app.main import create_app

AUTH = {'Authorization': 'Bearer test-credential'}


@pytest.fixture
def client():
    return TestClient(create_app(token='test-credential'))


def test_health_is_minimal(client):
    response = client.get('/api/v1/health')
    assert response.status_code == 200
    assert set(response.json()) == {'status', 'service', 'version'}
    assert response.headers['x-request-id']


@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Bearer wrong'}])
def test_authorization_required(client, headers):
    assert client.get('/api/v1/capabilities', headers=headers).status_code == 401


def test_honest_capabilities(client):
    data = client.get('/api/v1/capabilities', headers=AUTH).json()
    assert data['model']['available'] is False
    assert not any(data[key] for key in ['camera', 'microphone', 'desktop_actions', 'memory', 'cloud_requests'])


def test_foreign_origin_rejected(client):
    assert client.get('/api/v1/capabilities', headers={**AUTH, 'Origin': 'https://untrusted.example'}).status_code == 403


def test_missing_secret_fails_closed():
    with TestClient(create_app(token='')) as client:
        assert client.get('/api/v1/capabilities').status_code == 503


def test_model_setup_is_reported(client):
    response = client.post('/api/v1/chat', headers=AUTH, json={'text': 'Hello'})
    assert response.status_code == 503
    assert response.json()['code'] == 'model_setup_required'


@pytest.mark.parametrize('text', ['', '  ', 'x' * 4001])
def test_message_validation(client, text):
    assert client.post('/api/v1/chat', headers=AUTH, json={'text': text}).status_code == 422


def test_large_body_rejected(client):
    assert client.post('/api/v1/chat', headers=AUTH, json={'text': 'x' * 33000}).status_code == 413


def test_no_execution_endpoint(client):
    assert client.post('/api/v1/tools/execute', headers=AUTH, json={'command': 'anything'}).status_code == 404
