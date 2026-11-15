"""Local, bounded push-to-talk transcription and Windows offline speech synthesis."""
from io import BytesIO
import importlib.util
import logging
from math import log2
import os
from pathlib import Path
import tempfile
import threading
from dataclasses import dataclass
from time import perf_counter

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / 'models/whisper-tiny.en'
MULTILINGUAL_MODEL = ROOT / 'models/whisper-small'
PARAKEET_MODEL = ROOT / 'models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
PARAKEET_FILES = {
    'encoder': 'encoder.int8.onnx',
    'decoder': 'decoder.int8.onnx',
    'joiner': 'joiner.int8.onnx',
    'tokens': 'tokens.txt',
}
logger = logging.getLogger(__name__)

KOKORO_MODEL = ROOT / 'models/voice/kokoro-v1.0.onnx'
KOKORO_VOICES = ROOT / 'models/voice/voices-v1.0.bin'
MAX_AUDIO_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 45


@dataclass(frozen=True)
class VoiceConfig:
    model_path: Path
    language: str
    device: str
    compute_type: str
    preprocess: bool

    @classmethod
    def from_env(cls) -> 'VoiceConfig':
        language = os.getenv('ORACLE_VOICE_LANGUAGE', 'en').strip() or 'en'
        default_model = (
            MULTILINGUAL_MODEL
            if language in {'si', 'auto'} or (MULTILINGUAL_MODEL / 'model.bin').is_file()
            else MODEL
        )
        model_path = Path(os.getenv('ORACLE_VOICE_MODEL', '').strip() or default_model).expanduser()
        device = os.getenv('ORACLE_VOICE_DEVICE', 'auto').strip().lower() or 'auto'
        compute_type = os.getenv('ORACLE_VOICE_COMPUTE_TYPE', 'auto').strip().lower() or 'auto'
        preprocess = os.getenv('ORACLE_VOICE_PREPROCESS', 'false').strip().lower() in {'1', 'true', 'yes'}
        if language not in {'en', 'si', 'auto'}:
            raise ValueError('ORACLE_VOICE_LANGUAGE must be en, si, or auto')
        if device not in {'auto', 'cpu', 'cuda'}:
            raise ValueError('ORACLE_VOICE_DEVICE must be auto, cpu, or cuda')
        if compute_type not in {'auto', 'int8', 'int8_float16', 'float16', 'float32'}:
            raise ValueError('ORACLE_VOICE_COMPUTE_TYPE is not supported')
        return cls(model_path, language, device, compute_type, preprocess)


def _resolve_inference(config: VoiceConfig) -> tuple[str, str]:
    if config.device == 'auto':
        return ('cuda', 'float16') if config.compute_type == 'auto' else ('cuda', config.compute_type)
    if config.compute_type == 'auto':
        return (config.device, 'int8' if config.device == 'cpu' else 'float16')
    return config.device, config.compute_type


def estimate_pitch_f0(audio, sample_rate=16000):
    """
    Computes fundamental vocal pitch (F0) using autocorrelation across 30ms frames.
    Identifies typical adult pitch ranges (75 Hz to 350 Hz).
    """
    import numpy as np
    if len(audio) < int(sample_rate * 0.15):
        return None
    frame_len = int(sample_rate * 0.03)
    hop_len = int(sample_rate * 0.015)
    f0_list = []
    min_lag = int(sample_rate / 350)
    max_lag = int(sample_rate / 75)

    for i in range(0, len(audio) - frame_len, hop_len):
        frame = audio[i:i + frame_len]
        energy = np.sqrt(np.mean(frame * frame))
        if energy < 0.015:
            continue
        corr = np.correlate(frame, frame, mode='full')
        corr = corr[len(frame) - 1:]
        if len(corr) <= max_lag:
            continue
        search_region = corr[min_lag:max_lag]
        if len(search_region) == 0:
            continue
        peak_idx = np.argmax(search_region) + min_lag
        peak_val = corr[peak_idx]
        zero_lag = corr[0]
        if zero_lag > 0 and (peak_val / zero_lag) > 0.35:
            f0 = sample_rate / peak_idx
            f0_list.append(f0)

    if not f0_list:
        return None
    median_f0 = float(np.median(f0_list))
    return {
        'median_f0': round(median_f0, 1),
        'min_f0': round(float(np.percentile(f0_list, 10)), 1),
        'max_f0': round(float(np.percentile(f0_list, 90)), 1),
        'pitch_category': 'low' if median_f0 < 155 else ('mid' if median_f0 < 210 else 'high')
    }


def compute_vocal_timbre(audio, sample_rate=16000):
    """Computes spectral centroid (vocal brightness) of speech audio."""
    import numpy as np
    if len(audio) < 320:
        return 0.0
    fft = np.abs(np.fft.rfft(audio))
    freqs = np.fft.rfftfreq(len(audio), 1.0 / sample_rate)
    sum_fft = np.sum(fft)
    if sum_fft <= 1e-6:
        return 0.0
    centroid = np.sum(freqs * fft) / sum_fft
    return round(float(centroid), 1)


def filter_and_reduce_noise(audio, sample_rate=16000):
    """
    Applies DC offset removal, 80Hz high-pass IIR filtering to eliminate HVAC/desk rumble,
    per-bin Wiener filtering for stationary background noise suppression, and RMS dynamic
    range normalization.
    """
    import numpy as np
    if len(audio) < 160:
        return audio

    # 1. DC offset removal
    audio = audio - np.mean(audio)

    # 2. High-pass filter at ~80Hz (fs = 16000Hz, alpha = 0.9695)
    alpha = 0.9695
    hp = np.empty_like(audio)
    hp[0] = audio[0]
    for i in range(1, len(audio)):
        hp[i] = alpha * (hp[i - 1] + audio[i] - audio[i - 1])
    audio = hp

    # 3. Per-bin Wiener filtering -- estimates noise PSD from the quietest frames,
    #    then applies a per-frequency Wiener gain to suppress stationary noise
    #    without the musical-noise artifacts of a hard gate.
    n_fft = 512
    hop = 160  # 10 ms
    win = np.hanning(n_fft).astype(np.float32)

    # Pad so the last frame is complete
    pad_len = n_fft - (len(audio) % hop) if len(audio) % hop != 0 else 0
    padded = np.pad(audio, (n_fft // 2, n_fft // 2 + pad_len))

    # Build STFT magnitude + phase
    n_frames = (len(padded) - n_fft) // hop + 1
    n_bins = n_fft // 2 + 1
    mag = np.zeros((n_frames, n_bins), dtype=np.float32)
    phase = np.zeros((n_frames, n_bins), dtype=np.float32)
    for t in range(n_frames):
        frame = padded[t * hop: t * hop + n_fft] * win
        spec = np.fft.rfft(frame, n=n_fft)
        mag[t] = np.abs(spec)
        phase[t] = np.angle(spec)

    if n_frames >= 6:
        # Estimate noise PSD from the quietest 15% of frames (stationary noise)
        frame_power = np.mean(mag ** 2, axis=1)
        noise_idx = np.where(frame_power <= np.percentile(frame_power, 15))[0]
        noise_psd = np.mean(mag[noise_idx] ** 2, axis=0) if len(noise_idx) > 0 else np.zeros(n_bins)

        # Wiener gain: G = SNR / (SNR + 1),  SNR = max(0, |X|^2 - N^2) / N^2
        signal_psd = np.maximum(0.0, mag ** 2 - noise_psd)
        snr = signal_psd / np.maximum(1e-10, noise_psd)
        wiener = snr / (snr + 1.0)
        # Spectral floor: never suppress more than 90% of the signal
        wiener = np.maximum(wiener, 0.10)
        mag = mag * wiener

    # Reconstruct via overlap-add
    output = np.zeros(len(padded), dtype=np.float32)
    window_sum = np.zeros(len(padded), dtype=np.float32)
    for t in range(n_frames):
        frame_out = np.fft.irfft(mag[t] * np.exp(1j * phase[t]), n=n_fft).real * win
        output[t * hop: t * hop + n_fft] += frame_out
        window_sum[t * hop: t * hop + n_fft] += win ** 2

    window_sum = np.maximum(window_sum, 1e-8)
    audio = (output / window_sum)[n_fft // 2: n_fft // 2 + len(audio)].astype(np.float32)

    # 4. RMS dynamic normalization
    rms = float(np.sqrt(np.mean(audio * audio)))
    if rms > 0.004:
        target_rms = 0.075
        gain = min(4.0, max(0.5, target_rms / rms))
        audio = np.clip(audio * gain, -1.0, 1.0)

    return audio


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str | None = Field(default=None, max_length=50)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


class LocalVoice:
    def __init__(self, config: VoiceConfig | None = None):
        self.config = config or VoiceConfig.from_env()
        self.model = None
        self.parakeet = None
        self.parakeet_failed = False
        self.kokoro = None
        self.transcription_lock = threading.Lock()
        self.transcription_queue_lock = threading.Lock()
        self.waiting_finals = 0
        self.speech_lock = threading.Lock()
        self.loaded_device = None
        self.loaded_compute_type = None
        self.last_transcription = None
        self.last_speech_engine = None

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

    def parakeet_ready(self):
        return (
            self.config.language == 'en'
            and not self.parakeet_failed
            and all((PARAKEET_MODEL / filename).is_file() for filename in PARAKEET_FILES.values())
            and importlib.util.find_spec('sherpa_onnx') is not None
        )

    def transcribe_parakeet(self, audio):
        import sherpa_onnx

        if self.parakeet is None:
            paths = {key: str(PARAKEET_MODEL / name) for key, name in PARAKEET_FILES.items()}
            self.parakeet = sherpa_onnx.OfflineRecognizer.from_transducer(
                **paths, model_type='nemo_transducer', provider='cpu',
                num_threads=min(4, os.cpu_count() or 4),
            )
        stream = self.parakeet.create_stream()
        stream.accept_waveform(16000, audio)
        self.parakeet.decode_stream(stream)
        return stream.result.text.strip()

    def capabilities(self):
        kokoro_ready = KOKORO_MODEL.is_file() and KOKORO_VOICES.is_file()
        sapi_ready = os.name == 'nt' and importlib.util.find_spec('win32com') is not None
        return {
            'transcription_ready': (self.config.model_path / 'model.bin').is_file(),
            'speech_ready': kokoro_ready or sapi_ready,
            'speech_engine': 'kokoro' if kokoro_ready else ('sapi' if sapi_ready else 'none'),
            'voices': self.get_available_voices(),
            'processing': 'local_backend',
            'max_seconds': MAX_SECONDS,
            'model': str(self.config.model_path),
            'english_final_engine': 'parakeet' if self.parakeet_ready() else 'whisper',
            'language': self.config.language,
            'device': self.loaded_device or _resolve_inference(self.config)[0],
            'compute_type': self.loaded_compute_type or _resolve_inference(self.config)[1],
            'preprocess_default': self.config.preprocess,
            'last_transcription': self.last_transcription,
            'last_speech_engine': self.last_speech_engine,
        }

    def transcribe(self, payload, wake_mode=False, interim=False, preprocess: bool | None = None, include_profile: bool = True):
        started = perf_counter()
        if not payload or len(payload) > MAX_AUDIO_BYTES:
            raise HTTPException(413, 'Record up to 45 seconds and 4 MiB of audio')
        if not self.capabilities()['transcription_ready']:
            model_option = ' --model small' if self.config.model_path == MULTILINGUAL_MODEL else ''
            raise HTTPException(503, f'Local speech model is not prepared. Run scripts/prepare_voice_model.py{model_option}.')
        if interim:
            with self.transcription_queue_lock:
                acquired = not self.waiting_finals and self.transcription_lock.acquire(blocking=False)
        else:
            with self.transcription_queue_lock:
                self.waiting_finals += 1
            try:
                acquired = self.transcription_lock.acquire(timeout=3)
            finally:
                with self.transcription_queue_lock:
                    self.waiting_finals -= 1
        if not acquired:
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
            use_preprocess = self.config.preprocess if preprocess is None else preprocess
            if use_preprocess:
                audio = filter_and_reduce_noise(audio)
                if not len(audio) or float(np.sqrt(np.mean(audio * audio))) < 0.002:
                    return {'text': '', 'processing': 'local_backend', 'stored': False,
                            'diagnostics': {'reason': 'audio_below_threshold', 'preprocessed': True}}
            engine = 'whisper'
            raw_result = None
            info = None
            if not wake_mode and not interim and self.parakeet_ready():
                try:
                    raw_result = self.transcribe_parakeet(audio)
                    engine = 'parakeet'
                except Exception:
                    logger.exception('Parakeet transcription failed, falling back to Whisper')
                    self.parakeet = None
                    self.parakeet_failed = True
            if raw_result is None and self.model is None:
                from faster_whisper import WhisperModel
                device, compute_type = _resolve_inference(self.config)
                try:
                    self.model = WhisperModel(str(self.config.model_path), device=device, compute_type=compute_type,
                                              cpu_threads=min(4, os.cpu_count() or 4),
                                              num_workers=1, local_files_only=True)
                    self.loaded_device, self.loaded_compute_type = device, compute_type
                except Exception:
                    if device == 'cpu':
                        raise HTTPException(503, 'Local speech model could not be loaded') from None
                    self.model = WhisperModel(str(self.config.model_path), device='cpu', compute_type='int8',
                                              cpu_threads=min(4, os.cpu_count() or 4),
                                              num_workers=1, local_files_only=True)
                    self.loaded_device, self.loaded_compute_type = 'cpu', 'int8'
            vad_params = dict(
                threshold=0.35,              # more sensitive -- catches soft speech sooner
                min_speech_duration_ms=150,  # catch short commands like 'Oracle, stop'
                max_speech_duration_s=MAX_SECONDS,
                min_silence_duration_ms=350,  # don't cut speech too early
                speech_pad_ms=400            # give Whisper more context around edges
            ) if not interim else None
            def run_model():
                segments, info = self.model.transcribe(
                    audio, language=None if self.config.language == 'auto' else self.config.language,
                    beam_size=1 if interim else 7, vad_filter=not interim,
                    vad_parameters=vad_params, without_timestamps=True,
                    hotwords='Oracle' if wake_mode else None,
                    condition_on_previous_text=False)
                return ' '.join(segment.text.strip() for segment in segments).strip(), info

            try:
                if raw_result is None:
                    raw_result, info = run_model()
            except RuntimeError as error:
                if self.loaded_device != 'cuda' or not any(
                    marker in str(error).lower() for marker in ('cuda', 'cublas', 'cudnn')
                ):
                    raise
                from faster_whisper import WhisperModel
                self.model = WhisperModel(str(self.config.model_path), device='cpu', compute_type='int8',
                                          cpu_threads=min(4, os.cpu_count() or 4),
                                          num_workers=1, local_files_only=True)
                self.loaded_device, self.loaded_compute_type = 'cpu', 'int8'
                raw_result, info = run_model()
            self.last_transcription = {
                'engine': engine,
                'elapsed_ms': round((perf_counter() - started) * 1000, 1),
                'raw_text': raw_result,
                'text': raw_result,
                'language': getattr(info, 'language', self.config.language),
                'language_probability': getattr(info, 'language_probability', None),
                'preprocessed': use_preprocess,
            }
            f0_info = estimate_pitch_f0(audio) if include_profile and not interim else None
            voice_meta = {
                'f0': f0_info['median_f0'] if f0_info else None,
                'pitch_category': f0_info['pitch_category'] if f0_info else None,
                'min_f0': f0_info['min_f0'] if f0_info else None,
                'max_f0': f0_info['max_f0'] if f0_info else None,
                'spectral_centroid': compute_vocal_timbre(audio)
            } if f0_info else None
            return {
                'text': raw_result[:4000],
                'processing': 'local_backend',
                'stored': False,
                'voice_profile': voice_meta,
                'diagnostics': self.last_transcription
            }
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
                    self.last_speech_engine = 'kokoro'
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
                voice.Rate = round(10 * log2(speed))
                stream = win32com.client.Dispatch('SAPI.SpFileStream')
                stream.Open(filename, 3, False)
                voice.AudioOutputStream = stream
                voice.Speak(text, 16)  # Treat input as plain text, never SAPI XML or a filename.
                stream.Close()
                stream = None
                wav = Path(filename).read_bytes()
                self.last_speech_engine = 'windows_sapi'
                return wav
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
        preprocess = request.query_params.get('preprocess')
        preprocess_value = None if preprocess is None else preprocess.lower() == 'true'
        return await run_in_threadpool(
            voice.transcribe,
            await request.body(),
            request.query_params.get('mode') == 'wake',
            request.query_params.get('interim') == 'true',
            preprocess_value,
            request.query_params.get('profile') != 'false',
        )

    @router.get('/diagnostics')
    def diagnostics():
        return voice.capabilities()

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
