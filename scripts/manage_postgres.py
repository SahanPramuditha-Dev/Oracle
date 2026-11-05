"""Provision/start ORACLE's loopback-only PostgreSQL cluster without changing other instances."""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('ORACLE_PG_BIN', 'C:/Program Files/PostgreSQL/18/bin'))
CLUSTER = ROOT / 'data/postgresql'
PRIVATE = ROOT / 'data/dev/postgres-admin.json'
PORT = 55432


def run(name, *args, check=True):
    # Server children may inherit stdout on Windows; a pipe would keep communicate() waiting.
    with (ROOT / 'data/dev/postgres-setup.log').open('ab') as log:
        result = subprocess.run([str(BIN / (name + '.exe')), *map(str, args)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW)
    if check and result.returncode:
        raise RuntimeError(f'{name} failed. Check the local PostgreSQL log; no credentials were printed.')
    return result.returncode


def start():
    if not (CLUSTER / 'PG_VERSION').exists():
        raise RuntimeError('Run scripts/manage_postgres.py --provision first')
    if run('pg_ctl', '-D', CLUSTER, 'status', check=False) == 0:
        return
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', PORT)) == 0:
            raise RuntimeError('The dedicated ORACLE database port is occupied; existing listener left unchanged')
    run('pg_ctl', '-D', CLUSTER, '-l', ROOT / 'data/dev/postgres.log', '-w', 'start')


def provision():
    import psycopg
    from psycopg import sql
    from sqlalchemy.engine import URL
    PRIVATE.parent.mkdir(parents=True, exist_ok=True)
    if PRIVATE.exists():
        credentials = json.loads(PRIVATE.read_text())
    else:
        if CLUSTER.exists():
            raise RuntimeError('Unmanaged cluster directory exists; refusing to replace it')
        credentials = {'admin_password': secrets.token_urlsafe(36), 'app_password': secrets.token_urlsafe(36)}
        with PRIVATE.open('x') as file:
            json.dump(credentials, file)
    if not (CLUSTER / 'PG_VERSION').exists():
        password_file = ROOT / 'data/dev/postgres-init-password'
        try:
            password_file.write_text(credentials['admin_password'])
            run('initdb', '-D', CLUSTER, '-U', 'oracle_admin', '--auth=scram-sha-256', '--pwfile', password_file,
                '--encoding=UTF8', '--locale=C')
        finally:
            password_file.unlink(missing_ok=True)
        with (CLUSTER / 'postgresql.conf').open('a') as file:
            file.write(f"\n# ORACLE local development instance\nlisten_addresses='127.0.0.1'\nport={PORT}\nmax_connections=30\nshared_buffers='64MB'\npassword_encryption='scram-sha-256'\n")
    start()
    with psycopg.connect(host='127.0.0.1', port=PORT, user='oracle_admin',
                         password=credentials['admin_password'], dbname='postgres', autocommit=True) as db:
        if not db.execute("SELECT 1 FROM pg_roles WHERE rolname='oracle_app'").fetchone():
            db.execute(sql.SQL('CREATE ROLE oracle_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}').format(sql.Literal(credentials['app_password'])))
        if not db.execute("SELECT 1 FROM pg_database WHERE datname='oracle'").fetchone():
            db.execute('CREATE DATABASE oracle OWNER oracle_app')
    url = URL.create('postgresql+psycopg', username='oracle_app', password=credentials['app_password'],
                     host='127.0.0.1', port=PORT, database='oracle')
    (ROOT / 'data/dev/postgres-url').write_text(url.render_as_string(hide_password=False))
    print('ORACLE PostgreSQL ready on loopback port 55432; credentials saved only in ignored local files.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--provision', action='store_true')
    parser.add_argument('--stop', action='store_true')
    args = parser.parse_args()
    try:
        if args.stop:
            run('pg_ctl', '-D', CLUSTER, '-m', 'fast', '-w', 'stop')
        elif args.provision:
            provision()
        else:
            start()
    except Exception as error:
        print(f'PostgreSQL setup stopped ({type(error).__name__}). Check configuration and local logs.', file=sys.stderr)
        sys.exit(1)
