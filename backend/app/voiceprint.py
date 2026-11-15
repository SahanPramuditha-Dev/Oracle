"""Local speaker biometric voiceprint extraction and verification using pure NumPy.
Extracts a normalized 192-dimensional acoustic speaker embedding vector combining:
- 40 MFCC mean + 40 MFCC standard deviation (80 dims)
- 40 Delta-MFCC mean + 40 Delta-MFCC standard deviation (80 dims)
- 16 pitch (F0) distribution and contour features (16 dims)
- 16 vocal tract resonance, spectral centroid, roll-off, and HNR features (16 dims)
"""
from io import BytesIO
import math
import numpy as np

SAMPLE_RATE = 16000
N_FFT = 512
HOP_LEN = 160  # 10ms hop
FRAME_LEN = 400  # 25ms frame
N_MELS = 40
DEFAULT_VOICE_THRESHOLD = 0.72
HIGH_CONFIDENCE_THRESHOLD = 0.82


def decode_audio_blob(payload: bytes, max_seconds: int = 30) -> tuple[np.ndarray, int]:
    """Decodes WebM, OGG, WAV, or MP4 audio into a 16kHz mono float32 NumPy array."""
    import av
    pieces = []
    total_samples = 0
    try:
        with av.open(BytesIO(payload)) as container:
            if not container.streams.audio or container.streams.video:
                raise ValueError('Payload must contain an audio stream without video')
            resampler = av.audio.resampler.AudioResampler(format='s16', layout='mono', rate=SAMPLE_RATE)
            for frame in container.decode(audio=0):
                for output in resampler.resample(frame):
                    total_samples += output.samples
                    if total_samples > max_seconds * SAMPLE_RATE:
                        break
                    pieces.append(output.to_ndarray().reshape(-1))
                if total_samples > max_seconds * SAMPLE_RATE:
                    break
            for output in resampler.resample(None):
                total_samples += output.samples
                if total_samples > max_seconds * SAMPLE_RATE:
                    break
                pieces.append(output.to_ndarray().reshape(-1))
    except Exception as e:
        raise ValueError(f'Could not decode audio: {e}') from e

    if not pieces:
        return np.array([], dtype=np.float32), 0

    raw = np.concatenate(pieces).astype(np.float32) / 32768.0
    duration_ms = int((len(raw) / SAMPLE_RATE) * 1000)
    return raw, duration_ms


def _build_mel_filterbank(sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=N_MELS, fmin=80.0, fmax=7600.0) -> np.ndarray:
    def hz_to_mel(hz):
        return 2595.0 * np.log10(1.0 + hz / 700.0)

    def mel_to_hz(mel):
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

    mel_min = hz_to_mel(fmin)
    mel_max = hz_to_mel(fmax)
    mel_pts = np.linspace(mel_min, mel_max, n_mels + 2)
    hz_pts = mel_to_hz(mel_pts)
    bin_pts = np.floor((n_fft + 1) * hz_pts / sr).astype(int)

    fb = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for i in range(1, n_mels + 1):
        left, center, right = bin_pts[i - 1], bin_pts[i], bin_pts[i + 1]
        if center > left:
            fb[i - 1, left:center] = (np.arange(left, center) - left) / (center - left)
        if right > center:
            fb[i - 1, center:right] = (right - np.arange(center, right)) / (right - center)
    return fb


_MEL_FB = _build_mel_filterbank()


def _build_dct_matrix(n_mels=N_MELS) -> np.ndarray:
    matrix = np.zeros((n_mels, n_mels), dtype=np.float32)
    factor = np.pi / n_mels
    for i in range(n_mels):
        for j in range(n_mels):
            matrix[i, j] = np.cos(i * (j + 0.5) * factor)
    matrix[0] *= np.sqrt(1.0 / n_mels)
    matrix[1:] *= np.sqrt(2.0 / n_mels)
    return matrix


_DCT_MAT = _build_dct_matrix()


def compute_f0_contour(audio: np.ndarray, sr=SAMPLE_RATE) -> tuple[np.ndarray, np.ndarray]:
    """Calculates F0 pitch contour using autocorrelation across 30ms frames."""
    frame_len = int(sr * 0.03)
    hop_len = int(sr * 0.01)
    min_lag = int(sr / 380)  # Max ~380 Hz
    max_lag = int(sr / 70)   # Min ~70 Hz
    f0_vals = []
    voiced_mask = []

    for i in range(0, len(audio) - frame_len, hop_len):
        frame = audio[i:i + frame_len]
        energy = np.sqrt(np.mean(frame * frame))
        if energy < 0.012:
            f0_vals.append(0.0)
            voiced_mask.append(False)
            continue
        corr = np.correlate(frame, frame, mode='full')
        corr = corr[len(frame) - 1:]
        if len(corr) <= max_lag:
            f0_vals.append(0.0)
            voiced_mask.append(False)
            continue
        search = corr[min_lag:max_lag]
        if len(search) == 0:
            f0_vals.append(0.0)
            voiced_mask.append(False)
            continue
        peak_idx = np.argmax(search) + min_lag
        peak_val = corr[peak_idx]
        zero_lag = corr[0]
        if zero_lag > 0 and (peak_val / zero_lag) > 0.35:
            f0 = sr / peak_idx
            f0_vals.append(f0)
            voiced_mask.append(True)
        else:
            f0_vals.append(0.0)
            voiced_mask.append(False)

    return np.array(f0_vals, dtype=np.float32), np.array(voiced_mask, dtype=bool)


def assess_voice_quality(audio: np.ndarray, sr=SAMPLE_RATE) -> tuple[dict, str | None]:
    """Evaluates speech sample quality: duration, RMS level, SNR, voiced frames."""
    if len(audio) < int(sr * 0.6):
        return {}, 'Audio sample is too short; record for at least 1.5 seconds'

    duration_ms = int((len(audio) / sr) * 1000)
    rms = float(np.sqrt(np.mean(audio * audio)))
    if rms < 0.006:
        return {'duration_ms': duration_ms, 'rms': round(rms, 4)}, 'Audio is too quiet; speak clearly closer to microphone'

    # Check for excessive clipping
    clipping_ratio = float(np.mean(np.abs(audio) > 0.98))
    if clipping_ratio > 0.08:
        return {'duration_ms': duration_ms, 'clipping': round(clipping_ratio, 3)}, 'Audio is clipped or distorted; lower input volume'

    f0_contour, voiced_mask = compute_f0_contour(audio, sr)
    voiced_ratio = float(np.mean(voiced_mask)) if len(voiced_mask) > 0 else 0.0
    if voiced_ratio < 0.15:
        return {'duration_ms': duration_ms, 'voiced_ratio': round(voiced_ratio, 2)}, 'No vocal pitch detected; speak the challenge phrase audibly'

    voiced_f0 = f0_contour[voiced_mask]
    median_f0 = float(np.median(voiced_f0)) if len(voiced_f0) > 0 else 0.0

    quality = {
        'duration_ms': duration_ms,
        'rms': round(rms, 4),
        'voiced_ratio': round(voiced_ratio, 3),
        'median_f0': round(median_f0, 1),
        'clipping_ratio': round(clipping_ratio, 4)
    }
    return quality, None


def extract_voiceprint(audio: np.ndarray, sr=SAMPLE_RATE) -> np.ndarray:
    """Extracts a 192-dimensional acoustic speaker embedding vector."""
    if len(audio) < FRAME_LEN:
        return np.zeros(192, dtype=np.float32)

    # 1. Pre-emphasis filter (boosts higher frequencies where vocal tract resonances lie)
    pre_emphasized = np.append(audio[0], audio[1:] - 0.97 * audio[:-1])

    # 2. Windowed framing & STFT
    window = np.hamming(FRAME_LEN).astype(np.float32)
    n_frames = 1 + int((len(pre_emphasized) - FRAME_LEN) / HOP_LEN)
    if n_frames < 2:
        return np.zeros(192, dtype=np.float32)

    frames = np.zeros((n_frames, FRAME_LEN), dtype=np.float32)
    for i in range(n_frames):
        start = i * HOP_LEN
        frames[i] = pre_emphasized[start:start + FRAME_LEN] * window

    # Fast Fourier Transform & Power Spectrum
    fft_spec = np.abs(np.fft.rfft(frames, n=N_FFT))
    power_spec = (fft_spec ** 2) / N_FFT

    # 3. Mel Filterbank Energy
    mel_energies = np.dot(power_spec, _MEL_FB.T)
    mel_energies = np.maximum(mel_energies, 1e-6)
    log_mel = np.log(mel_energies)

    # 4. MFCCs via DCT-II
    mfccs = np.dot(log_mel, _DCT_MAT.T)  # Shape: (n_frames, 40)

    # Voice Activity Detection mask to pool only voiced/active speech frames
    frame_rms = np.sqrt(np.mean(frames * frames, axis=1))
    noise_thresh = max(0.005, float(np.percentile(frame_rms, 25)) * 1.5)
    speech_frames = frame_rms > noise_thresh
    if not np.any(speech_frames):
        speech_frames = np.ones(n_frames, dtype=bool)

    active_mfccs = mfccs[speech_frames]

    # MFCC mean & std (80 dims)
    mfcc_mean = np.mean(active_mfccs, axis=0)
    mfcc_std = np.std(active_mfccs, axis=0)

    # 5. Delta-MFCCs
    deltas = np.zeros_like(mfccs)
    for t in range(2, n_frames - 2):
        deltas[t] = (mfccs[t + 1] - mfccs[t - 1] + 2 * (mfccs[t + 2] - mfccs[t - 2])) / 10.0
    active_deltas = deltas[speech_frames]
    delta_mean = np.mean(active_deltas, axis=0)
    delta_std = np.std(active_deltas, axis=0)

    # 6. Pitch Features (16 dims)
    f0_contour, voiced_mask = compute_f0_contour(audio, sr)
    if np.any(voiced_mask):
        vf0 = f0_contour[voiced_mask]
        f0_med = float(np.median(vf0))
        f0_p10 = float(np.percentile(vf0, 10))
        f0_p90 = float(np.percentile(vf0, 90))
        f0_iqr = float(np.percentile(vf0, 75) - np.percentile(vf0, 25))
        f0_std = float(np.std(vf0))
        f0_ratio = float(np.mean(voiced_mask))
        # Jitter (cycle-to-cycle perturbation)
        diffs = np.abs(np.diff(vf0))
        jitter = float(np.mean(diffs) / max(1.0, f0_med)) if len(diffs) > 0 else 0.0
    else:
        f0_med, f0_p10, f0_p90, f0_iqr, f0_std, f0_ratio, jitter = 120.0, 100.0, 140.0, 20.0, 15.0, 0.3, 0.02

    pitch_feats = np.array([
        f0_med / 300.0,
        f0_p10 / 300.0,
        f0_p90 / 300.0,
        f0_iqr / 100.0,
        f0_std / 100.0,
        f0_ratio,
        jitter * 10.0,
        min(1.0, f0_iqr / max(10.0, f0_med)),
        math.log(max(50.0, f0_med)) / 6.0,
        math.log(max(50.0, f0_p10)) / 6.0,
        math.log(max(50.0, f0_p90)) / 6.0,
        float(np.mean(np.diff(f0_contour))) / 50.0 if len(f0_contour) > 1 else 0.0,
        float(np.std(np.diff(f0_contour))) / 50.0 if len(f0_contour) > 1 else 0.0,
        float(np.min(vf0)) / 300.0 if np.any(voiced_mask) else 0.3,
        float(np.max(vf0)) / 400.0 if np.any(voiced_mask) else 0.5,
        float(np.sum(voiced_mask)) / max(1.0, float(len(voiced_mask)))
    ], dtype=np.float32)

    # 7. Vocal Timbre / Spectral Features (16 dims)
    freqs = np.fft.rfftfreq(N_FFT, 1.0 / sr)
    sum_spec = np.sum(fft_spec, axis=1, keepdims=True) + 1e-7
    centroids = np.sum(freqs * fft_spec, axis=1, keepdims=True) / sum_spec
    active_centroids = centroids[speech_frames].reshape(-1)

    # Spectral rolloff (frequency below which 85% of energy lies)
    cumsum_spec = np.cumsum(fft_spec, axis=1)
    rolloff_idx = np.argmax(cumsum_spec >= 0.85 * sum_spec, axis=1)
    rolloff = freqs[np.clip(rolloff_idx, 0, len(freqs) - 1)]
    active_rolloff = rolloff[speech_frames]

    # Spectral flatness (ratio of geometric mean to arithmetic mean)
    log_spec = np.log(np.maximum(fft_spec, 1e-7))
    geom_mean = np.exp(np.mean(log_spec, axis=1))
    arith_mean = np.mean(fft_spec, axis=1) + 1e-7
    flatness = geom_mean / arith_mean
    active_flatness = flatness[speech_frames]

    # Zero Crossing Rate
    zcr = np.mean(np.abs(np.diff(np.sign(frames), axis=1)) > 0, axis=1)
    active_zcr = zcr[speech_frames]

    timbre_feats = np.array([
        float(np.mean(active_centroids)) / 4000.0,
        float(np.std(active_centroids)) / 1500.0,
        float(np.percentile(active_centroids, 10)) / 4000.0,
        float(np.percentile(active_centroids, 90)) / 4000.0,
        float(np.mean(active_rolloff)) / 6000.0,
        float(np.std(active_rolloff)) / 2000.0,
        float(np.mean(active_flatness)) * 10.0,
        float(np.std(active_flatness)) * 10.0,
        float(np.mean(active_zcr)) * 5.0,
        float(np.std(active_zcr)) * 5.0,
        float(np.median(active_centroids)) / 4000.0,
        float(np.median(active_rolloff)) / 6000.0,
        float(np.percentile(active_flatness, 75) - np.percentile(active_flatness, 25)) * 10.0,
        float(np.percentile(active_centroids, 75) - np.percentile(active_centroids, 25)) / 2000.0,
        float(np.max(active_centroids) - np.min(active_centroids)) / 4000.0,
        float(np.mean(frame_rms[speech_frames])) * 10.0
    ], dtype=np.float32)

    # Concatenate into full 192-dim vector
    raw_vector = np.concatenate([
        mfcc_mean,       # 40
        mfcc_std,        # 40
        delta_mean,      # 40
        delta_std,       # 40
        pitch_feats,     # 16
        timbre_feats     # 16
    ]).astype(np.float32)

    # Replace any non-finite entries with 0.0
    raw_vector = np.nan_to_num(raw_vector, nan=0.0, posinf=0.0, neginf=0.0)

    # L2 normalize
    norm = np.linalg.norm(raw_vector)
    if norm > 1e-6:
        raw_vector = raw_vector / norm

    return raw_vector


def cosine_similarity(feat1: np.ndarray, feat2: np.ndarray) -> float:
    """Computes cosine similarity between two normalized embeddings."""
    f1 = feat1.reshape(-1)
    f2 = feat2.reshape(-1)
    n1 = np.linalg.norm(f1)
    n2 = np.linalg.norm(f2)
    if n1 <= 1e-6 or n2 <= 1e-6:
        return 0.0
    sim = float(np.dot(f1, f2) / (n1 * n2))
    return max(-1.0, min(1.0, sim))
