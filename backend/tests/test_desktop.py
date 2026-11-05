from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from app.desktop import DesktopActions, ActionError
from app.main import create_app

AUTH = {'Authorization': 'Bearer test-token'}


@pytest.fixture
def actions(tmp_path):
    executable = tmp_path / 'sample.exe'
    executable.touch()
    calls = []
    return DesktopActions(apps={'sample': executable}, launch=calls.append), calls


def test_only_existing_allowlisted_apps_are_listed(actions):
    service, _ = actions
    assert service.list_apps() == [{'id': 'sample', 'name': 'sample'}]
    service.apps['missing'] = service.apps['sample'].parent / 'missing.exe'
    assert len(service.list_apps()) == 1


def test_proposal_does_not_launch_and_confirmation_runs_once(actions):
    service, calls = actions
    action = service.propose('sample')
    assert calls == []
    assert service.confirm(action['id'])['status'] == 'launch_requested'
    with pytest.raises(ActionError):
        service.confirm(action['id'])
    assert len(calls) == 1


@pytest.mark.parametrize('name', ['../sample', 'sample & calc', 'powershell', 'C:/sample.exe'])
def test_arbitrary_commands_and_paths_are_rejected(actions, name):
    service, calls = actions
    with pytest.raises(ActionError):
        service.propose(name)
    assert calls == []


def test_cancelled_and_expired_proposals_cannot_launch(actions):
    service, calls = actions
    action = service.propose('sample')
    service.cancel(action['id'])
    with pytest.raises(ActionError):
        service.confirm(action['id'])
    action = service.propose('sample')
    service.pending[action['id']]['deadline'] = 0
    with pytest.raises(ActionError):
        service.confirm(action['id'])
    assert calls == []


def test_concurrent_confirmation_cannot_repeat_launch(actions):
    service, calls = actions
    action = service.propose('sample')
    def confirm(_):
        try:
            return service.confirm(action['id'])['status']
        except ActionError:
            return 'rejected'
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(confirm, range(4)))
    assert results.count('launch_requested') == 1
    assert len(calls) == 1


def test_chat_open_uses_local_proposal_without_cloud(actions):
    service, calls = actions
    with TestClient(create_app(token='test-token', desktop=service)) as client:
        assert client.get('/api/v1/tools').status_code == 401
        reply = client.post('/api/v1/chat', headers=AUTH, json={'text': 'open sample'})
        assert reply.status_code == 200 and reply.json()['processing'] == 'local'
        action_id = reply.json()['action']['id']
        assert calls == []
        assert client.post(f'/api/v1/actions/{action_id}/confirm', headers=AUTH).status_code == 200
        assert client.post(f'/api/v1/actions/{action_id}/confirm', headers=AUTH).status_code == 409
    assert len(calls) == 1


def test_launch_failure_is_reported(actions):
    service, _ = actions
    def fail(_):
        raise OSError('private system detail')
    service.launch = fail
    with pytest.raises(ActionError, match='Windows could not launch'):
        service.confirm(service.propose('sample')['id'])


def test_website_target_is_preserved_and_only_opened_after_confirmation():
    calls = []
    service = DesktopActions(open_url=lambda url: calls.append(url) or True)
    target = 'https://example.com/CaseSensitive?q=Oracle'
    action = service.propose(target)
    assert calls == [] and action['name'] == target
    assert service.confirm(action['id'])['status'] == 'launch_requested'
    assert calls == [target]
    with pytest.raises(ActionError):
        service.confirm(action['id'])


@pytest.mark.parametrize('target', ['file:///C:/private', 'javascript://anything', 'https://user:password@example.com', 'https://example.com/ with spaces', 'https://example.com:invalid', 'https://example.com/\x00'])
def test_unsafe_website_inputs_never_reach_browser(target):
    calls = []
    service = DesktopActions(open_url=lambda url: calls.append(url) or True)
    with pytest.raises(ActionError):
        service.propose(target)
    assert calls == []


@pytest.mark.parametrize('command', ['please open sample', 'launch sample', 'start sample', 'Could you open sample please', 'Can you launch SAMPLE.exe'])
def test_supported_launch_phrases_still_require_confirmation(actions, command):
    service, calls = actions
    with TestClient(create_app(token='test-token', desktop=service)) as client:
        response = client.post('/api/v1/chat', headers=AUTH, json={'text': command})
        assert response.status_code == 200
        assert response.json()['processing'] == 'local'
        assert calls == []
        action_id = response.json()['action']['id']
        assert client.post(f'/api/v1/actions/{action_id}/confirm', headers=AUTH).status_code == 200
    assert len(calls) == 1


def test_polite_url_command_preserves_url_and_query():
    calls = []
    service = DesktopActions(open_url=lambda url: calls.append(url) or True)
    target = 'https://example.com/CaseSensitive?q=please'
    with TestClient(create_app(token='test-token', desktop=service)) as client:
        response = client.post('/api/v1/chat', headers=AUTH, json={'text': f'Please open {target}'})
        assert response.status_code == 200
        assert response.json()['action']['name'] == target
        assert calls == []
        action_id = response.json()['action']['id']
        client.post(f'/api/v1/actions/{action_id}/confirm', headers=AUTH)
    assert calls == [target]


def test_action_endpoint_accepts_full_website_target():
    service = DesktopActions(open_url=lambda _: True)
    target = 'https://example.com/' + 'a' * 180
    with TestClient(create_app(token='test-token', desktop=service)) as client:
        response = client.post('/api/v1/actions/propose', headers=AUTH, json={'app_id': target})
        assert response.status_code == 200
        assert response.json()['kind'] == 'website'
