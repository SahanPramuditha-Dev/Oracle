"""Read-only integration checks; never activate sensors, generate AI text or invoke actions."""
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import sys
import httpx

ROOT = Path(__file__).resolve().parents[1]


def check():
    token = (ROOT / 'data/dev/api-token').read_text().strip()
    with httpx.Client(base_url='http://127.0.0.1:8000', timeout=10) as client:
        health = client.get('/api/v1/health')
        health.raise_for_status()
        unauthorized = client.get('/api/v1/capabilities').status_code == 401
        client.headers['Authorization'] = 'Bearer ' + token
        capabilities = client.get('/api/v1/capabilities')
        capabilities.raise_for_status()
        caps = capabilities.json()
        counts = {}
        for resource in ['tasks', 'notes', 'memories', 'people']:
            response = client.get('/api/v1/' + resource)
            response.raise_for_status()
            counts[resource] = len(response.json()[resource])
    gates = {
        'gateway_healthy': health.json()['status'] == 'ok',
        'authorization_enforced': unauthorized,
        'postgresql_active': caps.get('record_storage') == 'postgresql',
        'image_reading_available': bool(caps.get('image_reading')),
        'image_memory_available': bool(caps.get('memory')),
        'object_detection_ready': bool(caps.get('object_detection')),
        'vision_qa_ready': bool(caps.get('vision_qa')),
        'face_recognition_ready': bool(caps.get('face_recognition')),
        'local_transcription_prepared': bool((caps.get('local_voice') or {}).get('transcription_ready')),
        'local_synthesis_available': bool((caps.get('local_voice') or {}).get('speech_ready')),
    }
    report = {
        'checked_utc': datetime.now(timezone.utc).isoformat(),
        'gates': gates,
        'record_counts': counts,
        'versions': {name: importlib.metadata.version(name) for name in ['fastapi', 'SQLAlchemy', 'alembic', 'faster-whisper', 'rapidocr-onnxruntime']},
        'sensors_activated': False,
        'cloud_generation_requested': False,
        'hardware_acceptance': 'printed-label and human microphone/speaker checks remain separate',
    }
    destination = ROOT / 'data/readiness/integration-gate.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2))
    print(json.dumps(gates, indent=2))
    return all(gates.values())


if __name__ == '__main__':
    try:
        sys.exit(0 if check() else 1)
    except Exception as error:
        print(f'Integration check unavailable ({type(error).__name__}); no credentials or record content printed.', file=sys.stderr)
        sys.exit(1)
