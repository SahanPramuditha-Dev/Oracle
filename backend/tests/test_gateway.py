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


def test_clock_questions_work_without_a_model(client):
    for question, expected in [('What time is it right now?', 'local time'),
                               ('What is the date today?', 'local date')]:
        response = client.post('/api/v1/chat?stream=true', headers=AUTH, json={'text': question})
        assert response.status_code == 200
        assert expected in response.json()['message']


def test_current_weather_uses_explicit_city_and_live_data(client, monkeypatch):
    from app import live_answers

    def get_json(url, **params):
        if 'geocoding' in url:
            assert params['name'] == 'Colombo'
            return {'results': [{'name': 'Colombo', 'country': 'Sri Lanka',
                                 'latitude': 6.93, 'longitude': 79.85}]}
        assert params['latitude'] == 6.93
        return {'current': {'temperature_2m': 29, 'weather_code': 61}}

    monkeypatch.setattr(live_answers, '_get_json', get_json)
    response = client.post('/api/v1/chat', headers=AUTH, json={
        'text': 'What’s the weather in Colombo right now?', 'weather_city': 'Kandy',
    })
    assert response.json()['message'] == 'It’s 29 °C with rain in Colombo, Sri Lanka.'


def test_companion_clock_answers_skip_model_and_persist_once(tmp_path, monkeypatch):
    from app.companion_gateway import Gateway

    (tmp_path / 'data/dev').mkdir(parents=True, exist_ok=True)
    (tmp_path / 'data/dev/api-token').write_text('mock-token', encoding='utf-8')
    gateway = Gateway(tmp_path / 'state', tmp_path)

    def model_must_not_run():
        pytest.fail('Clock questions should work without a model')

    monkeypatch.setattr(gateway, 'capabilities', model_must_not_run)
    first = gateway.send('clock-question', 'What is the current time?', 'deep')
    assert 'local time' in first['messages'][-1]['text']
    assert gateway.send('clock-question', 'What is the current time?', 'deep') == first


@pytest.mark.parametrize('text', ['', '  ', 'x' * 4001])
def test_message_validation(client, text):
    assert client.post('/api/v1/chat', headers=AUTH, json={'text': text}).status_code == 422


def test_large_body_rejected(client):
    assert client.post('/api/v1/chat', headers=AUTH, json={'text': 'x' * 33000}).status_code == 413


def test_no_execution_endpoint(client):
    assert client.post('/api/v1/tools/execute', headers=AUTH, json={'command': 'anything'}).status_code == 404


def test_provider_tls_keeps_verification_without_opening_host_key_log(tmp_path, monkeypatch):
    import ssl
    from app.tls import verified_tls

    unavailable_keylog = tmp_path / 'missing-parent' / 'tls.keys'
    monkeypatch.setenv('SSLKEYLOGFILE', str(unavailable_keylog))
    for context in (verified_tls(), verified_tls(system_trust=True)):
        assert context.check_hostname
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.keylog_filename is None


def test_companion_records_routing(monkeypatch, tmp_path):
    from app.companion_gateway import Handler, Gateway

    class DummyServer:
        def __init__(self, gw):
            self.gateway = gw
            self.transport = 'lan'

    (tmp_path / 'data/dev').mkdir(parents=True, exist_ok=True)
    (tmp_path / 'data/dev/api-token').write_text('mock-token', encoding='utf-8')
    gateway = Gateway(tmp_path / 'state', tmp_path)
    # pair dummy phone
    code = gateway.issue()
    paired = gateway.pair(code, 'Test Phone')
    token = paired['token']

    calls = []
    def mock_local_json(port, path, body=None, token=None, timeout=6, content_type="application/json", method=None):
        calls.append({'port': port, 'path': path, 'body': body, 'method': method})
        if 'tasks' in path:
            return {'tasks': [{'id': 't1', 'title': 'Test Timer', 'kind': 'timer'}]}
        return {'notes': [{'id': 'n1', 'title': 'Test Note', 'text': 'Content'}]}

    monkeypatch.setattr('app.companion_gateway.local_json', mock_local_json)

    handler = Handler.__new__(Handler)
    handler.server = DummyServer(gateway)
    handler.headers = {'Authorization': f'Bearer {token}'}

    # Test GET /companion/v1/records/tasks
    handler.path = '/companion/v1/records/tasks?due_only=true'
    handler.command = 'GET'
    res = handler.route()
    assert res['tasks'][0]['id'] == 't1'
    assert calls[-1]['path'] == '/api/v1/tasks?due_only=true'

    # Test GET /companion/v1/records/notes
    handler.path = '/companion/v1/records/notes?q=hello'
    handler.command = 'GET'
    res = handler.route()
    assert res['notes'][0]['id'] == 'n1'
    assert calls[-1]['path'] == '/api/v1/notes?q=hello'

    # Test POST /companion/v1/records/tasks
    handler.path = '/companion/v1/records/tasks'
    handler.command = 'POST'
    handler.body = lambda limit=24000: {'title': 'Buy milk', 'due': 1234567, 'kind': 'reminder'}
    handler.route()
    assert calls[-1]['path'] == '/api/v1/tasks'
    assert calls[-1]['method'] == 'POST'

    # Test DELETE /companion/v1/records/tasks/t1
    handler.path = '/companion/v1/records/tasks/t1'
    handler.command = 'DELETE'
    handler.route()
    assert calls[-1]['path'] == '/api/v1/tasks/t1'
    assert calls[-1]['method'] == 'DELETE'

    # Test GET /companion/v1/google/status
    handler.path = '/companion/v1/google/status'
    handler.command = 'GET'
    handler.route()
    assert calls[-1]['path'] == '/api/v1/google/status'

    # Test GET /companion/v1/google/events
    handler.path = '/companion/v1/google/events?days=30'
    handler.command = 'GET'
    handler.route()
    assert calls[-1]['path'] == '/api/v1/google/events?days=30'

    # Test POST /companion/v1/google/tasks/complete
    handler.path = '/companion/v1/google/tasks/complete'
    handler.command = 'POST'
    handler.body = lambda limit=24000: {'id': 'task-999', 'completed': True}
    handler.route()
    assert calls[-1]['path'] == '/api/v1/google/tasks/task-999'
    assert calls[-1]['method'] == 'PATCH'
    assert calls[-1]['body'] == {'completed': True}

    # Test GET /companion/v1/geo/places
    handler.path = '/companion/v1/geo/places'
    handler.command = 'GET'
    handler.route()
    assert calls[-1]['path'] == '/api/v1/geo/places'

    # Test GET /companion/v1/geo/route
    handler.path = '/companion/v1/geo/route?start_lat=6.9&start_lon=79.8&end_lat=6.92&end_lon=79.85'
    handler.command = 'GET'
    handler.route()
    assert calls[-1]['path'] == '/api/v1/geo/route?start_lat=6.9&start_lon=79.8&end_lat=6.92&end_lon=79.85'

    # Test POST /companion/v1/geo/parking
    handler.path = '/companion/v1/geo/parking'
    handler.command = 'POST'
    handler.body = lambda limit=24000: {'lat': 6.91, 'lon': 79.84, 'label': 'Car Spot'}
    handler.route()
    assert calls[-1]['path'] == '/api/v1/geo/parking'
    assert calls[-1]['method'] == 'POST'

    # Test GET /companion/v1/people
    handler.path = '/companion/v1/people'
    handler.command = 'GET'
    handler.route()
    assert calls[-1]['path'] == '/api/v1/people'

    # Test POST /companion/v1/people/consent/revoke
    handler.path = '/companion/v1/people/consent/revoke'
    handler.command = 'POST'
    handler.body = lambda limit=24000: {'id': 'person-123'}
    handler.route()
    assert calls[-1]['path'] == '/api/v1/people/person-123/consent/revoke'
    assert calls[-1]['method'] == 'POST'

