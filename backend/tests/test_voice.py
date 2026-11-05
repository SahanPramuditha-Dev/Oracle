from io import BytesIO
import wave
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.desktop import DesktopActions
from app.voice import LocalVoice, MAX_AUDIO_BYTES

AUTH = {'Authorization':'Bearer voice-test'}


def silence(seconds=1):
    output=BytesIO()
    with wave.open(output,'wb') as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\0\0' * (16000*seconds))
    return output.getvalue()


def test_voice_boundary_and_limits():
    with TestClient(create_app(token='voice-test',voice=LocalVoice())) as client:
        assert client.post('/api/v1/voice/transcribe',content=silence()).status_code==401
        assert client.post('/api/v1/voice/speak',json={'text':'Hello'}).status_code==401
        assert client.post('/api/v1/voice/transcribe',headers=AUTH|{'Content-Type':'audio/wav'},content=b'x'*(MAX_AUDIO_BYTES+1)).status_code==413
        assert client.post('/api/v1/voice/transcribe',headers=AUTH|{'Content-Type':'text/plain'},content=b'x').status_code==415
        assert client.post('/api/v1/voice/speak',headers=AUTH,json={'text':'x'*2001}).status_code==422


def test_silence_invalid_audio_and_duration_do_not_invent_speech(monkeypatch):
    voice=LocalVoice();monkeypatch.setattr(voice,'capabilities',lambda:{'transcription_ready':True})
    assert voice.transcribe(silence())['text']==''
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as invalid:voice.transcribe(b'not audio')
    assert invalid.value.status_code==422
    with pytest.raises(HTTPException) as too_long:voice.transcribe(silence(46))
    assert too_long.value.status_code==413
    voice.transcription_lock.acquire()
    try:
        with pytest.raises(HTTPException) as busy:voice.transcribe(silence())
        assert busy.value.status_code==429
    finally:voice.transcription_lock.release()


def test_real_local_speech_roundtrip_stays_behind_action_confirmation(tmp_path):
    voice=LocalVoice()
    if not all(voice.capabilities()[key] for key in ['transcription_ready','speech_ready']):
        pytest.skip('Prepared English model and Windows speech required')
    audio=voice.speak('Open notepad.')
    assert audio.startswith(b'RIFF') and len(audio)>1000
    transcript=voice.transcribe(audio)['text']
    assert 'open' in transcript.lower()
    executable=tmp_path/'notepad.exe';executable.touch();launched=[]
    with TestClient(create_app(token='voice-test',desktop=DesktopActions(apps={'notepad':executable},launch=launched.append),voice=voice)) as client:
        response=client.post('/api/v1/chat',headers=AUTH,json={'text':transcript})
        assert response.status_code==200 and response.json()['action']['name']=='notepad'
        assert launched==[]
    assert not list((Path(__file__).resolve().parents[2]/'data/dev/audio-temp').glob('*.wav'))


def test_prepared_local_voice_works_with_python_network_connections_blocked(monkeypatch):
    import socket
    voice=LocalVoice()
    if not all(voice.capabilities()[key] for key in ['transcription_ready','speech_ready']):
        pytest.skip('Prepared English model and Windows speech required')
    def blocked(*args,**kwargs):
        raise AssertionError('Local voice attempted a network connection')
    monkeypatch.setattr(socket.socket,'connect',blocked)
    assert 'open' in voice.transcribe(voice.speak('Open notepad.'))['text'].lower()


def test_kokoro_voices_endpoint_and_custom_speed_and_voice():
    voice = LocalVoice()
    with TestClient(create_app(token='voice-test', voice=voice)) as client:
        res = client.get('/api/v1/voice/voices', headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert 'engine' in data
        assert 'voices' in data
        assert isinstance(data['voices'], list)

        speak_res = client.post(
            '/api/v1/voice/speak',
            headers=AUTH,
            json={'text': 'Testing natural speech.', 'voice': 'af_heart', 'speed': 1.1}
        )
        assert speak_res.status_code == 200
        assert speak_res.headers['content-type'] == 'audio/wav'
        assert speak_res.content.startswith(b'RIFF')
