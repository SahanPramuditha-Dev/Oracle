from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from app import admin_protocol
from app.desktop import ActionError, DesktopActions
from app.main import create_app


class Recognizer:
    def __init__(self):
        self.person = {'id': 'admin-1', 'name': 'Test Admin', 'permission': 'administrator',
                       'enrollment_state': 'active', 'consent_status': 'granted'}
        self.face_count = 1
        self.voice_result = {}

    def list_people(self):
        return [dict(self.person)]

    def identify(self, body, threshold):
        assert body == b'image'
        assert threshold == 0.45
        return {'identified': [{'id': self.person['id'], 'matched': True, 'is_admin': True}] * self.face_count}

    def verify_voice(self, body, person_id, phrase, *, strict_challenge):
        assert body == b'audio'
        assert person_id == self.person['id']
        assert strict_challenge
        return {'verified': True, 'transcribed_text': f'{phrase.capitalize()}.',
                'target_id': person_id, **self.voice_result}

    def update_person(self, person_id, values):
        assert person_id == self.person['id']
        self.person.update(values)
        return dict(self.person)


@pytest.fixture
def gateway():
    recognizer = Recognizer()
    with TestClient(create_app(token='test-maintenance-token', recognizer=recognizer)) as client:
        result = client.get('/api/v1/auth/session', headers={
            'X-Oracle-Client': 'web', 'Sec-Fetch-Site': 'same-origin'})
        assert result.status_code == 200
        yield client, recognizer


def start(client):
    response = client.post('/api/v1/admin/attempts')
    assert response.status_code == 200
    assert 'phrase' not in response.json()
    return f"/api/v1/admin/attempts/{response.json()['id']}"


def face(client, attempt):
    return client.post(f'{attempt}/face', content=b'image', headers={'Content-Type': 'image/jpeg'})


def voice(client, attempt):
    return client.post(f'{attempt}/voice', content=b'audio', headers={'Content-Type': 'audio/webm'})


def grant(client):
    attempt = start(client)
    assert face(client, attempt).json()['verified']
    response = voice(client, attempt)
    assert response.status_code == 200
    assert response.json()['verified']
    assert voice(client, attempt).status_code == 410
    return attempt, {'X-Oracle-Admin-Grant': response.json()['grant']}


def change_admin(client, headers=None):
    return client.patch('/api/v1/people/admin-1', json={'notes': 'updated'}, headers=headers)


def test_gateway_requires_grant_and_enforces_revocation(gateway):
    client, _ = gateway
    assert change_admin(client).status_code == 403
    assert change_admin(client, {'X-Oracle-Admin-Grant': 'true'}).status_code == 403
    _, headers = grant(client)
    assert change_admin(client, headers).status_code == 200
    assert client.delete('/api/v1/admin/grant', headers=headers).status_code == 200
    assert change_admin(client, headers).status_code == 403


@pytest.mark.parametrize('voice_result', [
    {'target_id': 'someone-else'},
    {'transcribed_text': ''},
    {'transcribed_text': 'authorize oracle system'},
    {'verified': False},
])
def test_invalid_voice_consumes_attempt(gateway, voice_result):
    client, recognizer = gateway
    attempt = start(client)
    assert voice(client, attempt).status_code == 409
    recognizer.face_count = 2
    assert face(client, attempt).json() == {'verified': False}
    recognizer.face_count = 1
    assert face(client, attempt).json()['verified']
    recognizer.voice_result = voice_result
    result = voice(client, attempt).json()
    assert result['verified'] is False
    assert 'grant' not in result
    assert voice(client, attempt).status_code == 410


def test_cancel_and_role_revocation(gateway):
    client, recognizer = gateway
    attempt = start(client)
    assert face(client, attempt).json()['verified']
    assert client.delete(attempt).status_code == 200
    assert voice(client, attempt).status_code == 410
    attempt, headers = grant(client)
    assert client.delete(attempt).status_code == 200
    assert change_admin(client, headers).status_code == 403
    _, headers = grant(client)
    recognizer.person['consent_status'] = 'revoked'
    assert change_admin(client, headers).status_code == 403


def test_cancel_during_voice_prevents_a_late_grant(gateway, monkeypatch):
    client, recognizer = gateway
    attempt = start(client)
    assert face(client, attempt).json()['verified']
    entered, resume = Event(), Event()
    verify_voice = recognizer.verify_voice

    def delayed_voice(*args, **kwargs):
        entered.set()
        assert resume.wait(5)
        return verify_voice(*args, **kwargs)

    monkeypatch.setattr(recognizer, 'verify_voice', delayed_voice)
    with ThreadPoolExecutor(max_workers=1) as pool:
        response = pool.submit(voice, client, attempt)
        try:
            assert entered.wait(5)
            assert client.delete(attempt).status_code == 200
        finally:
            resume.set()
        assert response.result(timeout=5).status_code == 410


def test_expired_attempt_and_grant(gateway, monkeypatch):
    client, _ = gateway
    monkeypatch.setattr(admin_protocol, 'ATTEMPT_SECONDS', 0)
    assert face(client, start(client)).status_code == 410
    monkeypatch.setattr(admin_protocol, 'ATTEMPT_SECONDS', 120)
    monkeypatch.setattr(admin_protocol, 'GRANT_SECONDS', 0)
    _, headers = grant(client)
    assert change_admin(client, headers).status_code == 403


def test_browser_cannot_promote_an_identity_but_maintenance_can(gateway):
    client, recognizer = gateway
    recognizer.person['permission'] = 'standard'
    body = {'permission': 'administrator'}
    assert client.patch('/api/v1/people/admin-1', json=body).status_code == 403
    assert client.patch('/api/v1/people/admin-1', json=body, headers={
        'Authorization': 'Bearer test-maintenance-token'}).status_code == 200


@pytest.mark.parametrize('windows_outcome', ['requested', 'failed', 'unavailable'])
def test_lockdown_revokes_clearance_and_cancels_queued_actions(windows_outcome, monkeypatch):
    launches, lock_requests = [], []
    desktop = DesktopActions(apps={}, open_url=lambda url: launches.append(url) or True)

    def request_windows_lock():
        lock_requests.append(True)
        if windows_outcome == 'failed':
            raise ActionError('Windows rejected the request')
        return {'status': 'requested'}

    monkeypatch.setattr(desktop, 'lock_workstation', request_windows_lock)
    app = create_app(token='test-token', recognizer=Recognizer(),
                     desktop=desktop if windows_outcome != 'unavailable' else None)
    with TestClient(app) as client:
        client.get('/api/v1/auth/session', headers={'X-Oracle-Client': 'web', 'Sec-Fetch-Site': 'same-origin'})
        _, admin_headers = grant(client)
        attempt = start(client)
        proposal = {'app_id': 'https://example.org'}
        pending = None
        if windows_outcome != 'unavailable':
            pending = client.post('/api/v1/actions/propose', json=proposal).json()['id']

        parsed = client.post('/api/v1/chat', json={'text': 'Oracle, initiate Lockdown'}).json()
        assert parsed['action_trigger'] == 'activate_lockdown'
        assert not lock_requests
        response = client.post('/api/v1/protocols/lockdown')
        assert response.json() == {
            'oracle': 'restricted', 'windows': windows_outcome,
            'cancelled_actions': int(pending is not None), 'already_active': False,
        }
        assert change_admin(client, admin_headers).status_code == 403
        assert face(client, attempt).status_code == 410
        assert client.post('/api/v1/protocols/lockdown').json()['already_active']
        assert len(lock_requests) == int(windows_outcome != 'unavailable')
        if pending:
            assert client.post(f'/api/v1/actions/{pending}/confirm').status_code == 409
            assert client.post('/api/v1/actions/propose', json=proposal).status_code == 400
        grant(client)
        if pending:
            assert client.post(f'/api/v1/actions/{pending}/confirm').status_code == 409
            assert client.post('/api/v1/actions/propose', json=proposal).status_code == 200
        assert not launches
