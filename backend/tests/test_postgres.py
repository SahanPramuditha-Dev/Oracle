"""Integration tests use disposable schemas, never delete application records."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import sys
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import insert, select, text
from sqlalchemy.engine import make_url
from app.database import database_engine, notes, tasks, migrate
from app.main import create_app
from app.records import NoteInput, Records, TaskInput

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.migrate_records import import_sqlite


@pytest.fixture
def postgres():
    url = os.environ.get('ORACLE_TEST_DATABASE_URL')
    if not url:
        pytest.skip('Set ORACLE_TEST_DATABASE_URL for PostgreSQL integration checks')
    schema = 'oracle_test_' + uuid.uuid4().hex
    admin = database_engine(url)
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA {schema}'))
    scoped = make_url(url).update_query_dict({'options': f'-c search_path={schema}'})
    records = Records(scoped)
    try:
        yield records
    finally:
        records.engine.dispose()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        admin.dispose()


def test_postgres_api_persistence_search_and_due_reconciliation(postgres):
    auth = {'Authorization': 'Bearer postgres-test'}
    with TestClient(create_app(token='postgres-test', records=postgres)) as client:
        saved = client.post('/api/v1/notes', headers=auth, json={'title': '100%_literal', 'text': 'PostgreSQL acceptance'}).json()
        assert client.get('/api/v1/notes?q=%25_', headers=auth).json()['notes'][0]['id'] == saved['id']
        assert client.get('/api/v1/notes?q=absent', headers=auth).json()['notes'] == []
        client.post('/api/v1/tasks/import', headers=auth, json={'tasks': [{'id': 'overdue', 'title': 'Due', 'due': 1, 'kind': 'reminder'}]}).raise_for_status()
        assert client.get('/api/v1/tasks', headers=auth).json()['tasks'][0]['state'] == 'alert'
    second = Records(postgres.engine.url)
    try:
        assert second.notes('acceptance')[0]['id'] == saved['id']
        second.delete_note(saved['id'])
        assert not postgres.notes()
    finally:
        second.engine.dispose()


def test_postgres_concurrent_task_limit_is_atomic(postgres):
    now = postgres.now()
    with postgres.connect(write=True, resource='tasks') as db:
        db.execute(insert(tasks), [dict(id=str(n), title='Existing', due=now+100000, kind='timer', created=now) for n in range(99)])
    def add(_):
        try:
            postgres.add_task(TaskInput(title='New', kind='timer', due=now+100000))
            return 201
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(add, range(2))) == [201, 409]
    assert len(postgres.tasks()) == 100


def test_sqlite_copy_preserves_rows_and_is_idempotent(postgres, tmp_path):
    source = Records(tmp_path / 'source.sqlite3')
    saved = source.save_note(NoteInput(title='Transfer', text='Exact content'))
    source.add_task(TaskInput(title='Timer', due=source.now()+10000, kind='timer'))
    source.engine.dispose()
    for _ in range(2):
        counts, backup = import_sqlite(tmp_path / 'source.sqlite3', postgres)
        assert counts == {'tasks': 1, 'notes': 1} and backup.exists()
    assert postgres.notes()[0] == saved
    assert len(postgres.tasks()) == 1
    migrate(postgres.engine)
    assert postgres.notes()[0] == saved


def test_conflicting_copy_rolls_back_other_inserts(postgres, tmp_path):
    source = Records(tmp_path / 'source.sqlite3')
    saved = source.save_note(NoteInput(title='Conflict', text='Original'))
    source.add_task(TaskInput(title='Should roll back', due=source.now()+10000, kind='timer'))
    with postgres.connect(write=True) as db:
        db.execute(insert(notes).values(**(saved | {'text': 'Destination edit'})))
    source.engine.dispose()
    with pytest.raises(RuntimeError, match='Conflicting'):
        import_sqlite(tmp_path / 'source.sqlite3', postgres)
    assert not postgres.tasks()
    assert postgres.notes()[0]['text'] == 'Destination edit'


def test_postgres_image_memory_survives_new_connection_and_deletes_asset(postgres):
    from io import BytesIO
    from PIL import Image
    from app.memory import ImageMemories
    output = BytesIO(); Image.new('RGB',(100,100),'white').save(output,format='PNG')
    saved = ImageMemories(postgres).save(output.getvalue(),NoteInput(title='Label',text='Description'),'OCR','file')
    second = Records(postgres.engine.url)
    try:
        store = ImageMemories(second)
        assert store.find('Description')[0] == saved
        assert len(store.image(saved['id'])) > 0
        store.delete(saved['id'])
        with pytest.raises(HTTPException):
            ImageMemories(postgres).image(saved['id'])
    finally:
        second.engine.dispose()
