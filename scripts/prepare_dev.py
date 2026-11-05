"""Generate the local development proxy credential without printing it."""
import secrets
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'data/dev/api-token'
path.parent.mkdir(parents=True, exist_ok=True)
try:
    with path.open('x', encoding='utf-8') as file:
        file.write(secrets.token_urlsafe(48))
except FileExistsError:
    if len(path.read_text(encoding='utf-8').strip()) < 32:
        raise RuntimeError('Existing development credential is invalid')
print('Local development credential ready; excluded from source control.')
