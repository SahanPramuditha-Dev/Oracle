"""Tests for System Protocols, Admin Protocol voice/chat triggers, and clearance checks."""
import pytest
from fastapi.testclient import TestClient
from app.desktop import DesktopActions
from app.main import create_app, TOKEN_PATH


@pytest.fixture
def client():
    app = create_app()
    with TestClient(app) as test_client:
        token = TOKEN_PATH.read_text(encoding='utf-8').strip() if TOKEN_PATH.exists() else ''
        test_client.headers.update({'Authorization': f'Bearer {token}'})
        yield test_client


def test_protocol_admin_voice_command_variations(client):
    variations = [
        "activate protocol admin",
        "Activate Protocol Admin",
        "select protocol admin",
        "Select Protocol Admin.",
        "protocol admin",
        "Protocol Admin!",
        "admin protocol",
        "please activate the admin protocol",
        "could you initiate protocol admin",
        "ORACLE, activate admin",
    ]
    for phrase in variations:
        resp = client.post('/api/v1/chat', json={'text': phrase})
        assert resp.status_code == 200, f"Failed for phrase: {phrase}"
        data = resp.json()
        assert data.get('action_trigger') == 'open_admin_protocol', f"Expected open_admin_protocol for: {phrase}, got {data}"
        assert 'Admin protocol' in data.get('message', '')


def test_protocol_sentry_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'activate protocol sentry'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_sentry'
    assert 'Sentry protocol initiated' in data.get('message', '')


def test_protocol_sentinel_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, activate Sentinel'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_sentinel'
    assert 'Sentinel' in data.get('message', '')


def test_protocol_ghost_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, activate Ghost'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_ghost'
    assert 'Ghost' in data.get('message', '')


def test_protocol_focus_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, initiate Focus'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_focus'
    assert 'Focus' in data.get('message', '')


def test_protocol_diagnostic_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, run full diagnostics'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'open_self_diagnostic'
    assert 'diagnostic' in data.get('message', '').lower()


def test_protocol_command_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, activate Command'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'open_desktop_hud'
    assert 'Command' in data.get('message', '')


def test_protocol_atlas_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, activate Atlas'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_atlas'
    assert 'Atlas' in data.get('message', '')


def test_ambiguous_open_requests_a_destination(client):
    response = client.post('/api/v1/chat', json={'text': 'open it'})
    assert response.status_code == 200
    assert response.json() == {'message': 'What would you like me to open?', 'processing': 'local'}


def test_pet_command_waits_for_confirmation(tmp_path):
    executable = tmp_path / 'oracle-pet.exe'
    executable.touch()
    launches = []
    desktop = DesktopActions(apps={'oracle-pet': executable}, launch=launches.append)
    headers = {'Authorization': 'Bearer test-credential'}
    with TestClient(create_app(token='test-credential', desktop=desktop), headers=headers) as client:
        response = client.post('/api/v1/chat', json={'text': 'Oracle, run the desktop pet.'})
        assert response.status_code == 200
        action = response.json()['action']
        assert action['app_id'] == 'oracle-pet'
        assert launches == []
        confirmed = client.post(f"/api/v1/actions/{action['id']}/confirm")
        assert confirmed.status_code == 200
        assert launches == [executable]


def test_protocol_watchtower_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, activate Watchtower'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_watchtower'
    assert 'Watchtower' in data.get('message', '')


def test_protocol_briefing_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, initiate morning briefing'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_briefing'
    assert 'Briefing' in data.get('message', '')


def test_protocol_hibernate_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, initiate Hibernate'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_hibernate'
    assert 'Hibernate' in data.get('message', '')


def test_protocol_lockdown_command(client):
    resp = client.post('/api/v1/chat', json={'text': 'ORACLE, initiate Lockdown'})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('action_trigger') == 'activate_lockdown'
    assert 'Lockdown' in data.get('message', '')
