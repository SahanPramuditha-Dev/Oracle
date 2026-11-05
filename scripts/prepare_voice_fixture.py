"""Synthetic speech acceptance clip; does not record a microphone or play speakers."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from app.voice import LocalVoice
folder=ROOT/'data/readiness/voice-fixtures';folder.mkdir(parents=True,exist_ok=True)
(folder/'open-notepad.wav').write_bytes(LocalVoice().speak('Open notepad.'))
print('Synthetic local speech fixture prepared.')
