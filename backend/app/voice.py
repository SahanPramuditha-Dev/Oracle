"""Local, bounded push-to-talk transcription and Windows offline speech synthesis."""
from io import BytesIO
import importlib.util
import os
from pathlib import Path
import tempfile
import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / 'models/whisper-tiny.en'
KOKORO_MODEL = ROOT / 'models/voice/kokoro-v1.0.onnx'
KOKORO_VOICES = ROOT / 'models/voice/voices-v1.0.bin'
MAX_AUDIO_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 45


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str | None = Field(default=None, max_length=50)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


class LocalVoice:
    def __init__(self):
        self.model = None
        self.kokoro = None
        self.transcription_lock = threading.Lock()
        self.speech_lock = threading.Lock()

    def get_available_voices(self):
        if KOKORO_MODEL.is_file() and KOKORO_VOICES.is_file():
            try:
                if self.kokoro is None:
                    from kokoro_onnx import Kokoro
                    self.kokoro = Kokoro(str(KOKORO_MODEL), str(KOKORO_VOICES))
                return self.kokoro.get_voices()
            except Exception:
                pass
        return ['Windows SAPI Default'] if os.name == 'nt' else []

    def capabilities(self):
        kokoro_ready = KOKORO_MODEL.is_file() and KOKORO_VOICES.is_file()
        sapi_ready = os.name == 'nt' and importlib.util.find_spec('win32com') is not None
        return {
            'transcription_ready': (MODEL / 'model.bin').is_file(),
            'speech_ready': kokoro_ready or sapi_ready,
            'speech_engine': 'kokoro' if kokoro_ready else ('sapi' if sapi_ready else 'none'),
            'voices': self.get_available_voices(),
            'processing': 'local_backend',
            'max_seconds': MAX_SECONDS,
        }

    def transcribe(self, payload):
        if not payload or len(payload) > MAX_AUDIO_BYTES:
            raise HTTPException(413, 'Record up to 45 seconds and 4 MiB of audio')
        if not self.capabilities()['transcription_ready']:
            raise HTTPException(503, 'Local speech model is not prepared. Run scripts/prepare_voice_model.py.')
        if not self.transcription_lock.acquire(blocking=False):
            raise HTTPException(429, 'Local transcription is busy. Wait before trying again.')
        try:
            import av
            import numpy as np
            pieces = []; samples = 0
            try:
                with av.open(BytesIO(payload)) as container:
                    if not container.streams.audio or container.streams.video:
                        raise HTTPException(415, 'Send audio without a video stream')
                    resampler = av.audio.resampler.AudioResampler(format='s16', layout='mono', rate=16000)
                    for frame in container.decode(audio=0):
                        for output in resampler.resample(frame):
                            samples += output.samples
                            if samples > MAX_SECONDS * 16000:
                                raise HTTPException(413, 'Record no more than 45 seconds')
                            pieces.append(output.to_ndarray().reshape(-1))
                    for output in resampler.resample(None):
                        samples += output.samples
                        if samples > MAX_SECONDS * 16000:
                            raise HTTPException(413, 'Record no more than 45 seconds')
                        pieces.append(output.to_ndarray().reshape(-1))
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(422, 'This audio could not be decoded') from None
            audio = np.concatenate(pieces).astype(np.float32) / 32768 if pieces else np.array([], dtype=np.float32)
            if not len(audio) or float(np.sqrt(np.mean(audio * audio))) < 0.004:
                return {'text': '', 'processing': 'local_backend', 'stored': False}
            if self.model is None:
                from faster_whisper import WhisperModel
                self.model = WhisperModel(str(MODEL), device='cpu', compute_type='int8',
                                          cpu_threads=min(4, os.cpu_count() or 4),
                                          num_workers=1, local_files_only=True)
            segments, _ = self.model.transcribe(audio, language='en', beam_size=1, vad_filter=True,
                                               condition_on_previous_text=False)
            result = ' '.join(segment.text.strip() for segment in segments).strip()
            return {'text': result[:4000], 'processing': 'local_backend', 'stored': False}
        finally:
            self.transcription_lock.release()

    def speak(self, text: str, voice_name: str | None = None, speed: float = 1.0) -> bytes:
        if not text.strip():
            raise HTTPException(422, 'Enter text to speak')
        if not self.capabilities()['speech_ready']:
            raise HTTPException(503, 'Local speech synthesis is unavailable')
        if not self.speech_lock.acquire(blocking=False):
            raise HTTPException(429, 'Local speech synthesis is busy')

        try:
            # 1. Prefer Kokoro natural neural TTS if model files are available
            if KOKORO_MODEL.is_file() and KOKORO_VOICES.is_file():
                try:
                    if self.kokoro is None:
                        from kokoro_onnx import Kokoro
                        self.kokoro = Kokoro(str(KOKORO_MODEL), str(KOKORO_VOICES))
                    chosen_voice = voice_name or 'af_heart'
                    if chosen_voice not in self.kokoro.get_voices():
                        chosen_voice = 'af_heart'
                    samples, sample_rate = self.kokoro.create(text.strip(), voice=chosen_voice, speed=speed, lang='en-us')
                    import soundfile as sf
                    buf = BytesIO()
                    sf.write(buf, samples, sample_rate, format='WAV')
                    return buf.getvalue()
                except Exception:
                    pass

            # 2. Windows SAPI fallback
            filename = None
            stream = None
            import pythoncom
            pythoncom.CoInitialize()
            try:
                import win32com.client
                folder = ROOT / 'data/dev/audio-temp'
                folder.mkdir(parents=True, exist_ok=True)
                handle, filename = tempfile.mkstemp(suffix='.wav', dir=folder)
                os.close(handle)
                voice = win32com.client.Dispatch('SAPI.SpVoice')
                stream = win32com.client.Dispatch('SAPI.SpFileStream')
                stream.Open(filename, 3, False)
                voice.AudioOutputStream = stream
                voice.Speak(text, 16)  # Treat input as plain text, never SAPI XML or a filename.
                stream.Close()
                stream = None
                return Path(filename).read_bytes()
            except Exception:
                raise HTTPException(503, 'Local speech synthesis failed') from None
            finally:
                if stream is not None:
                    stream.Close()
                if filename:
                    Path(filename).unlink(missing_ok=True)
                pythoncom.CoUninitialize()
        finally:
            self.speech_lock.release()


def voice_router(voice):
    router = APIRouter(prefix='/api/v1/voice')

    @router.post('/transcribe')
    async def transcribe(request: Request):
        if request.headers.get('content-type', '').split(';')[0] not in {'audio/webm','audio/ogg','audio/wav','audio/mp4','audio/x-wav'}:
            raise HTTPException(415, 'Send WebM, Ogg, MP4 or WAV audio')
        return await run_in_threadpool(voice.transcribe, await request.body())

    @router.post('/speak')
    async def speak(body: SpeechInput):
        return Response(
            await run_in_threadpool(voice.speak, body.text, body.voice, body.speed),
            media_type='audio/wav',
            headers={'Cache-Control': 'no-store'}
        )

    @router.get('/voices')
    def list_voices():
        return {
            'engine': voice.capabilities().get('speech_engine'),
            'voices': voice.capabilities().get('voices', [])
        }

    return router
