"""Explicitly download the small English speech model; runtime inference never downloads."""
from pathlib import Path
import hashlib
import json
import ssl
import httpx

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'models/whisper-tiny.en'
folder.mkdir(parents=True, exist_ok=True)
repo = 'Systran/faster-whisper-tiny.en'
with httpx.Client(verify=ssl.create_default_context(), follow_redirects=True, timeout=120) as client:
    response = client.get(f'https://huggingface.co/api/models/{repo}'); response.raise_for_status()
    revision = response.json()['sha']
    names = {item['rfilename'] for item in response.json()['siblings']}
    manifest = []
    for name in ['config.json','model.bin','tokenizer.json','vocabulary.txt','vocabulary.json','preprocessor_config.json']:
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
        manifest.append({'name':name,'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})
(folder/'manifest.json').write_text(json.dumps({'repo':repo,'revision':revision,'files':manifest},indent=2))
print('Local tiny English speech model prepared. No Ollama download or service was used.')
