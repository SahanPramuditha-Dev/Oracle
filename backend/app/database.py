"""Database configuration and portable SQLAlchemy schema; credentials stay server-side."""
import os
from pathlib import Path
from sqlalchemy import BigInteger, Boolean, Column, ForeignKey, Index, LargeBinary, MetaData, String, Table, Text, create_engine, false
from sqlalchemy.engine import URL, make_url
from alembic import command
from alembic.config import Config
from dotenv import dotenv_values
from sqlalchemy import JSON

ROOT = Path(__file__).resolve().parents[2]
metadata = MetaData()
atlas_locations = Table('atlas_locations', metadata,
    Column('id', String(40), primary_key=True), Column('data', JSON, nullable=False))
tasks = Table('tasks', metadata,
    Column('id', String(100), primary_key=True), Column('title', String(200), nullable=False),
    Column('due', BigInteger, nullable=False), Column('kind', String(20), nullable=False),
    Column('created', BigInteger, nullable=False), Column('url', Text))
Index('task_due', tasks.c.due)
notes = Table('notes', metadata,
    Column('id', String(100), primary_key=True), Column('title', String(200), nullable=False),
    Column('text', Text, nullable=False), Column('created', BigInteger, nullable=False),
    Column('updated', BigInteger, nullable=False))
Index('note_updated', notes.c.updated.desc(), notes.c.id)
locks = Table('record_locks', metadata, Column('name', String(20), primary_key=True))
memories = Table('memories', metadata,
    Column('id', String(100), primary_key=True), Column('title', String(200), nullable=False),
    Column('text', Text, nullable=False), Column('ocr_text', Text, nullable=False),
    Column('created', BigInteger, nullable=False), Column('updated', BigInteger, nullable=False),
    Column('source', String(20), nullable=False), Column('width', BigInteger, nullable=False),
    Column('height', BigInteger, nullable=False), Column('sha256', String(64), nullable=False),
    Column('capture_person_id', String(100), ForeignKey('enrolled_people.id', ondelete='SET NULL')),
    Column('capture_auto_excluded', Boolean, nullable=False, server_default=false()),
    Column('image', LargeBinary, nullable=False))
Index('memory_created', memories.c.created.desc(), memories.c.id)

people = Table('enrolled_people', metadata,
    Column('id', String(100), primary_key=True),
    Column('name', String(200), nullable=False),
    Column('notes', Text, nullable=False),
    Column('created', BigInteger, nullable=False),
    Column('updated', BigInteger, nullable=False),
    Column('relationship', String(20), nullable=False, server_default='guest'),
    Column('permission', String(20), nullable=False, server_default='standard'),
    Column('enrollment_state', String(30), nullable=False, server_default='incomplete'),
    Column('consent_status', String(20), nullable=False, server_default='pending'),
    Column('consented_at', BigInteger),
    Column('retention_days', BigInteger, nullable=False, server_default='0'),
    Column('last_verified', BigInteger))
Index('person_name', people.c.name)
Index('person_created', people.c.created.desc(), people.c.id)
face_samples = Table('face_samples', metadata,
    Column('id', String(100), primary_key=True),
    Column('person_id', String(100), ForeignKey('enrolled_people.id', ondelete='CASCADE'), nullable=False),
    Column('embedding', LargeBinary, nullable=False),
    Column('sample_hash', String(64), nullable=False),
    Column('created', BigInteger, nullable=False),
    Column('quality', Text, nullable=False))
Index('face_sample_person', face_samples.c.person_id)
Index('face_sample_unique', face_samples.c.person_id, face_samples.c.sample_hash, unique=True)

authentication_events = Table('authentication_events', metadata,
    Column('id', String(100), primary_key=True),
    Column('person_id', String(100), ForeignKey('enrolled_people.id', ondelete='SET NULL')),
    Column('method', String(30), nullable=False),
    Column('success', BigInteger, nullable=False),
    Column('reason', Text, nullable=False),
    Column('created', BigInteger, nullable=False))
Index('authentication_event_created', authentication_events.c.created.desc(), authentication_events.c.id)

voice_samples = Table('voice_samples', metadata,
    Column('id', String(100), primary_key=True),
    Column('person_id', String(100), ForeignKey('enrolled_people.id', ondelete='CASCADE'), nullable=False),
    Column('embedding', LargeBinary, nullable=False),
    Column('sample_hash', String(64), nullable=False),
    Column('passphrase', String(200), nullable=False, server_default='Authorize Oracle System'),
    Column('duration_ms', BigInteger, nullable=False, server_default='0'),
    Column('created', BigInteger, nullable=False),
    Column('quality', Text, nullable=False))
Index('voice_sample_person', voice_samples.c.person_id)
Index('voice_sample_unique', voice_samples.c.person_id, voice_samples.c.sample_hash, unique=True)

product_records = Table('product_records', metadata,
    Column('id', String(100), primary_key=True), Column('barcode', String(80)),
    Column('brand', String(200)), Column('name', String(300), nullable=False),
    Column('variant', String(300)), Column('category', String(120)),
    Column('manufacturer', String(200)), Column('model', String(200)),
    Column('packaging', String(200)), Column('capacity', String(100)),
    Column('specifications', Text, nullable=False), Column('source_url', Text),
    Column('verification_status', String(30), nullable=False), Column('updated', BigInteger, nullable=False))
Index('product_barcode', product_records.c.barcode)
Index('product_name', product_records.c.name)
product_lookup_history = Table('product_lookup_history', metadata,
    Column('id', String(100), primary_key=True), Column('query', Text, nullable=False),
    Column('result', Text, nullable=False), Column('created', BigInteger, nullable=False))


def configured_url():
    values = {**dotenv_values(ROOT / 'backend/.env'), **os.environ}
    return values.get('ORACLE_DATABASE_URL') or URL.create('sqlite', database=str(ROOT / 'data/oracle.sqlite3'))


def database_engine(url):
    if isinstance(url, Path):
        url.parent.mkdir(parents=True, exist_ok=True)
        url = URL.create('sqlite', database=str(url))
    parsed = make_url(url)
    if parsed.drivername in {'postgres', 'postgresql'}:
        parsed = parsed.set(drivername='postgresql+psycopg')
    if parsed.get_backend_name() not in {'sqlite', 'postgresql'}:
        raise ValueError('Use PostgreSQL or SQLite for ORACLE records')
    options = {'connect_args': {'timeout': 5, 'check_same_thread': False}} if parsed.get_backend_name() == 'sqlite' else {
        'connect_args': {'connect_timeout': 5, 'options': parsed.query.get('options', '') + ' -c statement_timeout=10000 -c lock_timeout=5000'},
        'pool_size': 5, 'max_overflow': 5, 'pool_timeout': 5}
    return create_engine(parsed, pool_pre_ping=True, hide_parameters=True, **options)


def migrate(engine):
    config = Config()
    config.set_main_option('script_location', str(ROOT / 'backend/migrations'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
