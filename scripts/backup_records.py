"""Create a PostgreSQL custom-format backup; do not expose the connection URL in arguments."""
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.database import configured_url
from sqlalchemy.engine import make_url


if __name__ == '__main__':
    try:
        url = make_url(configured_url())
        if url.get_backend_name() != 'postgresql':
            raise RuntimeError('PostgreSQL must be configured for this backup command')
        folder = ROOT / 'data/backups'
        folder.mkdir(parents=True, exist_ok=True)
        destination = folder / ('oracle-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.dump')
        environment = os.environ.copy()
        environment.update(PGDATABASE=url.database, PGHOST=url.host or '127.0.0.1',
                           PGPORT=str(url.port or 5432), PGUSER=url.username,
                           PGPASSWORD=url.password, PGCONNECT_TIMEOUT='5')
        binary = Path(os.environ.get('ORACLE_PG_BIN', 'C:/Program Files/PostgreSQL/18/bin')) / 'pg_dump.exe'
        with (ROOT / 'data/dev/postgres-backup.log').open('ab') as log:
            result = subprocess.run([str(binary), '--no-password', '--format=custom', '--file', str(destination)],
                env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW, timeout=120)
        if result.returncode:
            destination.unlink(missing_ok=True)
            raise RuntimeError('Backup did not finish')
        print('PostgreSQL backup created in ignored data/backups. Restore into a separate database for recovery verification.')
    except Exception as error:
        print(f'Backup stopped ({type(error).__name__}); no credentials printed.', file=sys.stderr)
        sys.exit(1)
