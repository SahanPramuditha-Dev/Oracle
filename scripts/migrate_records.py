"""Back up SQLite, import transactionally, verify every row, then optionally activate PostgreSQL."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import socket
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.database import notes, tasks
from app.records import Records
from sqlalchemy import insert, select
from dotenv import set_key


def import_sqlite(source: Path, target: Records):
    backup_dir = ROOT / 'data/backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / ('oracle-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.sqlite3')
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(backup) as copy:
            original.backup(copy)
    with sqlite3.connect(backup) as db:
        db.row_factory = sqlite3.Row
        data = {table.name: [dict(row) for row in db.execute(f'SELECT * FROM {table.name}')] for table in (tasks, notes)}
    # Both resources are locked in a stable order, including when the destination already has records.
    with target.connect(write=True, resource='tasks') as connection:
        if target.engine.dialect.name == 'postgresql':
            from app.database import locks
            connection.execute(select(locks.c.name).where(locks.c.name == 'notes').with_for_update()).one()
        for table in (tasks, notes):
            existing = {row['id']: dict(row) for row in connection.execute(select(table)).mappings()}
            incoming = data[table.name]
            if len(set(existing) | {row['id'] for row in incoming}) > (100 if table.name == 'tasks' else 1000):
                raise RuntimeError('Destination record limit would be exceeded')
            for row in incoming:
                if row['id'] in existing:
                    if existing[row['id']] != row:
                        raise RuntimeError('Conflicting record found; destination was not overwritten')
                else:
                    connection.execute(insert(table).values(**row))
            verified = {row['id']: dict(row) for row in connection.execute(select(table)).mappings()}
            if any(verified.get(row['id']) != row for row in incoming):
                raise RuntimeError('Record verification failed; import rolled back')
    return {name: len(rows) for name, rows in data.items()}, backup


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--activate', action='store_true')
    args = parser.parse_args()
    try:
        if args.activate:
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1', 8000)) == 0:
                    raise RuntimeError('Stop the gateway before activating a database cutover')
        url = (ROOT / 'data/dev/postgres-url').read_text().strip()
        records = Records(url)
        source = ROOT / 'data/oracle.sqlite3'
        counts, backup = import_sqlite(source, records) if source.exists() else ({'notes': 0, 'tasks': 0}, None)
        records.engine.dispose()
        if args.activate:
            set_key(str(ROOT / 'backend/.env'), 'ORACLE_DATABASE_URL', url)
        print(f"Verified {counts['notes']} notes and {counts['tasks']} tasks.")
        print('SQLite backup retained in data/backups.' if backup else 'Fresh PostgreSQL store; no SQLite source existed.')
        print('PostgreSQL activated; restart the gateway.' if args.activate else 'Import verified; current gateway configuration unchanged.')
    except Exception as error:
        print(f'Migration stopped ({type(error).__name__}); configuration was not activated. Credentials were not printed.', file=sys.stderr)
        sys.exit(1)
