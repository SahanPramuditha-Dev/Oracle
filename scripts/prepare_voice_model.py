"""Prepare a local speech model without allowing downloads at inference time."""
import argparse
from pathlib import Path
import hashlib
import json
import ssl
import httpx

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', choices=('tiny.en', 'small'), default='tiny.en')
args = parser.parse_args()
folder = ROOT / 'models' / f'whisper-{args.model}'
folder.mkdir(parents=True, exist_ok=True)
repo = f'Systran/faster-whisper-{args.model}'
with httpx.Client(verify=ssl.create_default_context(), follow_redirects=True, timeout=120) as client:
    response = client.get(f'https://huggingface.co/api/models/{repo}'); response.raise_for_status()
    revision = response.json()['sha']
    names = {item['rfilename'] for item in response.json()['siblings']}
    manifest = []
    for name in ['config.json','tokenizer.json','vocabulary.txt','vocabulary.json','preprocessor_config.json','model.bin']:
        if name not in names:
            continue
        destination = folder / name
        if not destination.exists():
            temporary = folder / (name + '.partial')
            try:
                with client.stream('GET', f'https://huggingface.co/{repo}/resolve/{revision}/{name}') as stream:
                    stream.raise_for_status()
                    with temporary.open('wb') as file:
                        for chunk in stream.iter_bytes(): file.write(chunk)
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
        with destination.open('rb') as file:
            digest = hashlib.file_digest(file, 'sha256').hexdigest()
        manifest.append({'name':name,'bytes':destination.stat().st_size,'sha256':digest})
(folder/'manifest.json').write_text(json.dumps({'repo':repo,'revision':revision,'files':manifest},indent=2))
print(f'Local Whisper {args.model} speech model prepared.')
