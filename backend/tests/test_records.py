from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
import pytest
from app.main import create_app
from app.records import Records, TaskInput

AUTH = {'Authorization': 'Bearer records-test'}


def client(path):
    return TestClient(create_app(token='records-test', records=Records(path)))


def test_note_survives_new_app_and_can_be_searched_edited_deleted(tmp_path):
    path = tmp_path / 'records.sqlite3'
    with client(path) as first:
        saved = first.post('/api/v1/notes', headers=AUTH, json={'title': 'Design', 'text': 'Use SQLite for local records'}).json()
    with client(path) as second:
        assert second.get('/api/v1/notes?q=sqlite', headers=AUTH).json()['notes'][0] == saved
        assert second.put('/api/v1/notes/' + saved['id'], headers=AUTH,
                          json={'title': 'Updated', 'text': 'Corrected'}).status_code == 200
        assert second.get('/api/v1/notes?q=SQLite', headers=AUTH).json()['notes'] == []
        assert second.delete('/api/v1/notes/' + saved['id'], headers=AUTH).status_code == 200
        assert second.get('/api/v1/notes', headers=AUTH).json()['notes'] == []


def test_overdue_reconciles_after_restart_and_snooze_and_cancel_persist(tmp_path, monkeypatch):
    path = tmp_path / 'records.sqlite3'
    clock = [1000000]
    monkeypatch.setattr(Records, 'now', staticmethod(lambda: clock[0]))
    with client(path) as first:
        task = first.post('/api/v1/tasks', headers=AUTH,
                          json={'title': 'Tea', 'due': clock[0] + 1000, 'kind': 'timer'}).json()
    clock[0] += 2000
    with client(path) as second:
        assert second.get('/api/v1/tasks', headers=AUTH).json()['tasks'][0]['state'] == 'alert'
        assert second.post(f"/api/v1/tasks/{task['id']}/snooze", headers=AUTH, json={'minutes': 5}).status_code == 200
    with client(path) as third:
        assert third.get('/api/v1/tasks', headers=AUTH).json()['tasks'][0]['state'] == 'pending'
        third.delete('/api/v1/tasks/' + task['id'], headers=AUTH)
        assert third.get('/api/v1/tasks', headers=AUTH).json()['tasks'] == []


@pytest.mark.parametrize('resource', ['tasks', 'notes'])
def test_record_boundary(tmp_path, resource):
    with client(tmp_path / 'records.sqlite3') as app:
        assert app.get('/api/v1/' + resource).status_code == 401
        assert app.get('/api/v1/' + resource, headers=AUTH | {'Origin': 'https://foreign.example'}).status_code == 403
        assert app.post('/api/v1/' + resource, headers=AUTH, json={}).status_code == 422


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'https://user:password@example.com', 'https://example.com:invalid'])
def test_unsafe_meeting_link_rejected(tmp_path, url):
    with client(tmp_path / 'records.sqlite3') as app:
        assert app.post('/api/v1/tasks', headers=AUTH, json={
            'title': 'Meeting', 'due': Records.now() + 10000, 'kind': 'reminder', 'url': url}).status_code == 422


def test_task_validation_and_missing_records(tmp_path):
    with client(tmp_path / 'records.sqlite3') as app:
        for title, due in [(' ', Records.now() + 10000), ('Past', 1), ('Long timer', Records.now() + 90000000)]:
            assert app.post('/api/v1/tasks', headers=AUTH, json={'title': title, 'due': due, 'kind': 'timer'}).status_code == 422
        assert app.post('/api/v1/tasks/missing/snooze', headers=AUTH, json={'minutes': 0}).status_code == 422
        assert app.post('/api/v1/tasks/missing/snooze', headers=AUTH, json={'minutes': 5}).status_code == 404
        assert app.put('/api/v1/notes/missing', headers=AUTH, json={'title': 'New', 'text': 'text'}).status_code == 404


def test_parallel_writes_and_literal_search(tmp_path):
    records = Records(tmp_path / 'records.sqlite3')
    with ThreadPoolExecutor(max_workers=4) as pool:
        result = list(pool.map(lambda n: records.add_task(TaskInput(title=f'Task {n}', due=Records.now() + 10000, kind='timer')), range(20)))
    assert len({item['id'] for item in result}) == len(records.tasks()) == 20
    assert records.notes("%' OR 1=1 --") == []


def test_browser_import_is_idempotent_and_preserves_overdue(tmp_path):
    with client(tmp_path / 'records.sqlite3') as app:
        item = {'id': 'old-browser-task', 'title': 'Existing reminder', 'due': 1000,
                'created': 500, 'kind': 'reminder', 'state': 'pending'}
        for _ in range(2):
            assert app.post('/api/v1/tasks/import', headers=AUTH, json={'tasks': [item]}).status_code == 200
        tasks = app.get('/api/v1/tasks', headers=AUTH).json()['tasks']
        assert len(tasks) == 1 and tasks[0]['state'] == 'alert'
        assert tasks[0]['created'] == 500


def test_note_commands_stay_local_without_model(tmp_path):
    with client(tmp_path / 'records.sqlite3') as app:
        assert app.post('/api/v1/chat', headers=AUTH, json={'text': 'save note Plan: Build durable records'}).json()['processing'] == 'local'
        found = app.post('/api/v1/chat', headers=AUTH, json={'text': 'find notes durable'}).json()
        assert found['processing'] == 'local' and 'Build durable records' in found['message']


@pytest.mark.parametrize('text', ['save note   : content', 'save note title:   ', 'save note'])
def test_incomplete_note_commands_give_usage_without_saving(tmp_path, text):
    with client(tmp_path / 'records.sqlite3') as app:
        response = app.post('/api/v1/chat', headers=AUTH, json={'text': text})
        assert response.status_code == 200 and response.json()['processing'] == 'local'
        assert app.get('/api/v1/notes', headers=AUTH).json()['notes'] == []


@pytest.mark.parametrize('due', [10**30, True, 1.5])
def test_invalid_due_is_validation_error_not_database_failure(tmp_path, due):
    with client(tmp_path / 'records.sqlite3') as app:
        assert app.post('/api/v1/tasks', headers=AUTH, json={
            'title': 'Invalid date', 'kind': 'reminder', 'due': due}).status_code == 422


def test_timer_duration_uses_server_clock_not_stale_client_due(tmp_path, monkeypatch):
    monkeypatch.setattr(Records, 'now', staticmethod(lambda: 100000))
    with client(tmp_path / 'records.sqlite3') as app:
        result = app.post('/api/v1/tasks', headers=AUTH, json={
            'title': 'One second', 'kind': 'timer', 'due': 1, 'duration_ms': 1000})
        assert result.status_code == 201
        assert result.json()['due'] == 101000
        assert result.json()['created'] == 100000
        assert app.post('/api/v1/tasks', headers=AUTH, json={
            'title': 'Reminder', 'kind': 'reminder', 'due': 200000, 'duration_ms': 1000}).status_code == 422


def test_empty_note_listing_uses_order_index(tmp_path):
    records = Records(tmp_path / 'records.sqlite3')
    with records.connect() as db:
        plan = db.exec_driver_sql('EXPLAIN QUERY PLAN SELECT * FROM notes ORDER BY updated DESC, id LIMIT 100').mappings().all()
    assert any('note_updated' in row['detail'] for row in plan)
