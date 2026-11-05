"""Local durable productivity records. No model or external service is involved."""
import time
import uuid
from contextlib import contextmanager
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy import select, insert, update, delete, func
from .database import configured_url, database_engine, migrate, tasks as task_table, notes as note_table, locks

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator


class TaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due: int = Field(gt=0, le=253402300799999, strict=True)
    kind: Literal['timer', 'reminder']
    duration_ms: int | None = Field(default=None, ge=1000, le=86400000, strict=True)
    url: str | None = Field(default=None, max_length=2048)

    @field_validator('title')
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError('Enter a title')
        return value.strip()

    @field_validator('url')
    @classmethod
    def safe_url(cls, value):
        if not value:
            return None
        try:
            parsed = urlsplit(value)
            if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
                    or parsed.username or parsed.password or '\\' in value
                    or any(c.isspace() or ord(c) < 32 for c in value)):
                raise ValueError()
            _ = parsed.port
        except ValueError:
            raise ValueError('Use an http or https link without credentials') from None
        return value


class NoteInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=12000)

    @field_validator('title', 'text')
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError('Enter non-empty text')
        return value.strip()


class SnoozeInput(BaseModel):
    minutes: int = Field(ge=1, le=1440)


class ImportedTask(TaskInput):
    id: str = Field(min_length=1, max_length=80)
    created: int = Field(default=0, ge=0, le=253402300799999, strict=True)


class TaskImport(BaseModel):
    tasks: list[ImportedTask] = Field(max_length=100)


class Records:
    def __init__(self, url, *, initialize=True):
        self.engine = database_engine(url)
        if initialize:
            migrate(self.engine)

    @classmethod
    def from_env(cls):
        return cls(configured_url())

    @contextmanager
    def connect(self, write=False, resource=None):
        with self.engine.connect() as db:
            try:
                if write and self.engine.dialect.name == 'sqlite':
                    db.exec_driver_sql('BEGIN IMMEDIATE')
                if write and resource and self.engine.dialect.name == 'postgresql':
                    db.execute(select(locks.c.name).where(locks.c.name == resource).with_for_update()).one()
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    @staticmethod
    def now():
        return int(time.time() * 1000)

    def tasks(self):
        now = self.now()
        with self.connect() as db:
            return [dict(row) | {'state': 'alert' if row['due'] <= now else 'pending'}
                    for row in db.execute(select(task_table).order_by(task_table.c.due, task_table.c.id)).mappings()]

    def add_task(self, body: TaskInput):
        now = self.now()
        if body.duration_ms is not None and body.kind != 'timer':
            raise HTTPException(422, 'A duration is only valid for timers')
        due = now + body.duration_ms if body.duration_ms is not None else body.due
        if due <= now:
            raise HTTPException(422, 'Choose a future due time')
        if body.kind == 'timer' and due - now > 86400000:
            raise HTTPException(422, 'Timers can last up to 24 hours')
        item = body.model_dump(exclude={'duration_ms'}) | {'id': str(uuid.uuid4()), 'created': now, 'due': due}
        with self.connect(write=True, resource='tasks') as db:
            if db.scalar(select(func.count()).select_from(task_table)) >= 100:
                raise HTTPException(409, 'Remove a task before adding more (100 maximum)')
            db.execute(insert(task_table).values(**item))
        return item | {'state': 'pending'}

    def notes(self, query=''):
        statement = select(note_table).order_by(note_table.c.updated.desc(), note_table.c.id).limit(100)
        if query:
            statement = statement.where(func.lower(note_table.c.title + '\n' + note_table.c.text).contains(query.lower(), autoescape=True))
        with self.connect() as db:
            return [dict(row) for row in db.execute(statement).mappings()]

    def save_note(self, body: NoteInput, note_id=None):
        now = self.now()
        with self.connect(write=True, resource='notes') as db:
            if note_id:
                result = db.execute(update(note_table).where(note_table.c.id == note_id).values(
                    title=body.title, text=body.text, updated=now))
                if not result.rowcount:
                    raise HTTPException(404, 'Note not found')
            else:
                if db.scalar(select(func.count()).select_from(note_table)) >= 1000:
                    raise HTTPException(409, 'Note limit reached (1000 maximum)')
                note_id = str(uuid.uuid4())
                db.execute(insert(note_table).values(id=note_id, title=body.title, text=body.text, created=now, updated=now))
            return dict(db.execute(select(note_table).where(note_table.c.id == note_id)).mappings().one())

    def import_tasks(self, body: TaskImport):
        with self.connect(write=True, resource='tasks') as db:
            existing = set(db.scalars(select(task_table.c.id)))
            incoming = {'browser:' + item.id for item in body.tasks}
            if len(existing | incoming) > 100:
                raise HTTPException(409, 'Import exceeds the 100-task limit')
            for item in body.tasks:
                identity = 'browser:' + item.id
                if identity not in existing:
                    db.execute(insert(task_table).values(id=identity, title=item.title, due=item.due, kind=item.kind,
                        created=item.created or min(self.now(), item.due), url=item.url))
                    existing.add(identity)

    def delete_task(self, task_id):
        with self.connect(write=True) as db:
            db.execute(delete(task_table).where(task_table.c.id == task_id))

    def snooze(self, task_id, minutes):
        now = self.now()
        with self.connect(write=True) as db:
            result = db.execute(update(task_table).where(task_table.c.id == task_id).values(due=now + minutes * 60000, created=now))
            if not result.rowcount:
                raise HTTPException(404, 'Task not found')

    def delete_note(self, note_id):
        with self.connect(write=True) as db:
            db.execute(delete(note_table).where(note_table.c.id == note_id))


def records_router(records: Records):
    router = APIRouter(prefix='/api/v1')

    @router.get('/tasks')
    def tasks():
        return {'tasks': records.tasks(), 'server_time': records.now()}

    @router.post('/tasks', status_code=201)
    def add_task(body: TaskInput):
        return records.add_task(body)

    @router.post('/tasks/import')
    def import_tasks(body: TaskImport):
        records.import_tasks(body)
        return {'status': 'imported'}

    @router.delete('/tasks/{task_id}')
    def delete_task(task_id: str):
        records.delete_task(task_id)
        return {'status': 'deleted'}

    @router.post('/tasks/{task_id}/snooze')
    def snooze(task_id: str, body: SnoozeInput):
        records.snooze(task_id, body.minutes)
        return {'status': 'snoozed'}

    @router.get('/notes')
    def notes(q: str = ''):
        if len(q) > 200:
            raise HTTPException(422, 'Search is limited to 200 characters')
        return {'notes': records.notes(q)}

    @router.post('/notes', status_code=201)
    def add_note(body: NoteInput):
        return records.save_note(body)

    @router.put('/notes/{note_id}')
    def edit_note(note_id: str, body: NoteInput):
        return records.save_note(body, note_id)

    @router.delete('/notes/{note_id}')
    def delete_note(note_id: str):
        records.delete_note(note_id)
        return {'status': 'deleted'}

    return router
