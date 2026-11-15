"""Tests for speaker biometric voiceprint extraction, enrollment, and verification."""
import io
import json
import numpy as np
import pytest
import soundfile as sf
from sqlalchemy import create_engine
from app.database import metadata, people, voice_samples
from app.people import PersonRecognizer
from app.voiceprint import (
    extract_voiceprint,
    assess_voice_quality,
    cosine_similarity,
    decode_audio_blob,
    DEFAULT_VOICE_THRESHOLD
)


def _generate_wav(duration=2.0, sr=16000, f0=150.0):
    t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)
    # Fundamental + 2 harmonics + slight noise
    audio = 0.35 * np.sin(2 * np.pi * f0 * t) + 0.18 * np.sin(2 * np.pi * 2 * f0 * t) + 0.08 * np.sin(2 * np.pi * 3 * f0 * t)
    audio += 0.005 * np.random.randn(len(t)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format='WAV')
    return buf.getvalue(), audio


@pytest.fixture
def test_db():
    engine = create_engine('sqlite:///:memory:')
    metadata.create_all(engine)
    return engine


def test_voiceprint_vector_dimensions_and_norm():
    _, audio = _generate_wav(duration=2.0, sr=16000, f0=140.0)
    feat = extract_voiceprint(audio)
    assert feat.shape == (192,)
    assert np.isfinite(feat).all()
    assert abs(np.linalg.norm(feat) - 1.0) < 1e-4


def test_voice_quality_assessment():
    # Too short (<0.6s)
    short = np.zeros(4000, dtype=np.float32)
    q, reason = assess_voice_quality(short)
    assert 'too short' in reason.lower()

    # Silent / quiet
    silent = np.zeros(32000, dtype=np.float32)
    q, reason = assess_voice_quality(silent)
    assert 'too quiet' in reason.lower()

    # Normal vocal tone
    _, audio = _generate_wav(duration=2.5, sr=16000, f0=160.0)
    q, reason = assess_voice_quality(audio)
    assert reason is None
    assert q['duration_ms'] == 2500
    assert q['voiced_ratio'] > 0.3


def test_voice_enroll_and_list_samples(test_db):
    rec = PersonRecognizer(test_db)
    # Create an enrolled person
    with test_db.begin() as conn:
        conn.execute(people.insert().values(
            id='test_person_1',
            name='Test Administrator',
            notes='Primary owner',
            created=1000,
            updated=1000,
            relationship='owner',
            permission='administrator',
            enrollment_state='active'
        ))

    wav_bytes, _ = _generate_wav(duration=2.0, sr=16000, f0=150.0)
    res = rec.enroll_voice('test_person_1', wav_bytes, passphrase='Authorize Oracle System')
    assert res['id'] == 'test_person_1'
    assert res['voice_sample_count'] == 1
    assert 'sample_id' in res

    samples = rec.list_voice_samples('test_person_1')
    assert len(samples['voice_samples']) == 1
    assert samples['voice_samples'][0]['passphrase'] == 'Authorize Oracle System'


def test_voice_verify_pass_and_fail(test_db):
    rec = PersonRecognizer(test_db)
    with test_db.begin() as conn:
        conn.execute(people.insert().values(
            id='test_admin',
            name='Sahan',
            notes='Admin',
            created=1000,
            updated=1000,
            relationship='owner',
            permission='administrator',
            enrollment_state='active'
        ))

    wav_bytes, _ = _generate_wav(duration=2.0, sr=16000, f0=145.0)
    rec.enroll_voice('test_admin', wav_bytes, passphrase='Authorize Oracle System')

    # Verify with matching voice (same pitch/harmonic structure)
    matching_wav, _ = _generate_wav(duration=2.0, sr=16000, f0=146.0)
    res_pass = rec.verify_voice(matching_wav, person_id='test_admin', expected_passphrase='Authorize Oracle System', threshold=0.70)
    assert res_pass['verified'] is True
    assert res_pass['voiceprint_matched'] is True
    assert res_pass['similarity_score'] >= 0.70

    # Verify with markedly different voice (e.g. 290 Hz high pitch)
    diff_wav, _ = _generate_wav(duration=2.0, sr=16000, f0=290.0)
    res_fail = rec.verify_voice(diff_wav, person_id='test_admin', expected_passphrase='Authorize Oracle System', threshold=0.96)
    assert res_fail['voiceprint_matched'] is False


def test_delete_voice_sample(test_db):
    rec = PersonRecognizer(test_db)
    with test_db.begin() as conn:
        conn.execute(people.insert().values(
            id='test_p2',
            name='Operator',
            notes='',
            created=1000,
            updated=1000,
            relationship='guest',
            permission='standard',
            enrollment_state='active'
        ))

    wav_bytes, _ = _generate_wav(duration=2.0, sr=16000, f0=170.0)
    res = rec.enroll_voice('test_p2', wav_bytes)
    sample_id = res['sample_id']

    del_res = rec.delete_voice_sample('test_p2', sample_id)
    assert del_res['deleted'] is True

    samples = rec.list_voice_samples('test_p2')
    assert len(samples['voice_samples']) == 0
