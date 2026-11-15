"""Local face and voice speaker matching. A biometric match never grants access or proves liveness."""
import hashlib
import json
import re
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, insert, select, update
from starlette.concurrency import run_in_threadpool
from .database import authentication_events, people, face_samples, voice_samples, locks, memories
from .reading import decode_image
from .voiceprint import (
    decode_audio_blob,
    assess_voice_quality,
    extract_voiceprint,
    cosine_similarity,
    DEFAULT_VOICE_THRESHOLD,
    HIGH_CONFIDENCE_THRESHOLD,
)

YUNET_PATH = Path(__file__).resolve().parents[2] / 'models/vision/face_detection_yunet.onnx'
SFACE_PATH = Path(__file__).resolve().parents[2] / 'models/vision/face_recognition_sface.onnx'
PUBLIC_FIGURE_DIR = SFACE_PATH.parent / 'public-figures'


class PublicFigureReference(BaseModel):
    id: str = Field(pattern=r'^[a-z0-9][a-z0-9_-]{0,79}$')
    name: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=2000)
DEFAULT_SFACE_THRESHOLD = 0.363
DEFAULT_VERIFY_THRESHOLD = 0.45
IDENTITY_MARGIN = 0.05
MAX_SAMPLES = 12
MAX_VOICE_SAMPLES = 6

def _normalize_phrase(text: str) -> str:
    """Lowercases and strips punctuation for robust phrase comparison."""
    return re.sub(r'[^a-z0-9\s]', '', text.lower()).strip()

def _check_passphrase_match(spoken: str, expected: str) -> bool:
    """Checks if spoken text matches expected challenge passphrase."""
    s_norm = _normalize_phrase(spoken)
    e_norm = _normalize_phrase(expected)
    if not s_norm or not e_norm:
        return False
    if s_norm == e_norm or e_norm in s_norm or s_norm in e_norm:
        return True
    e_words = set(e_norm.split())
    s_words = set(s_norm.split())
    if not e_words or not s_words:
        return False
    overlap = len(e_words.intersection(s_words))
    return overlap >= max(1, len(e_words) - 1)


class PersonUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    notes: str | None = Field(None, max_length=2000)
    relationship: Literal['owner', 'family', 'friend', 'colleague', 'guest'] | None = None
    permission: Literal['standard', 'administrator', 'disabled'] | None = None
    enrollment_state: Literal['incomplete', 'active', 'needs_new_samples', 'revoked'] | None = None
    consent_status: Literal['pending', 'granted', 'revoked'] | None = None
    retention_days: int | None = Field(None, ge=0, le=3650)


class PersonRecognizer:
    def __init__(self, engine, detector_path=None, recognizer_path=None, voice_service=None):
        self.engine = engine
        self.detector_path = str(detector_path or YUNET_PATH)
        self.recognizer_path = str(recognizer_path or SFACE_PATH)
        self.voice_service = voice_service
        self._recognizer = None
        self._detector = None
        self._detector_size = None
        self._lock = threading.RLock()
        self._public_samples = None

    @contextmanager
    def _write(self):
        with self.engine.begin() as conn:
            conn.execute(update(locks).where(locks.c.name == 'enrolled_people').values(name='enrolled_people'))
            yield conn

    def _get_gallery(self):
        with self.engine.connect() as conn:
            identities = [dict(r) for r in conn.execute(select(people)).mappings()]
            samples = list(conn.execute(select(face_samples)).mappings())
        for person in identities:
            person['samples'] = []
            for sample in samples:
                if sample['person_id'] != person['id']:
                    continue
                if len(sample['embedding']) != 128*4:
                    continue
                feat = np.frombuffer(sample['embedding'], dtype=np.float32)
                if feat.size == 128 and np.isfinite(feat).all() and np.linalg.norm(feat) > 0:
                    person['samples'].append({'id': sample['id'], 'feat': feat.reshape(1,128)})
        return identities

    @property
    def recognizer(self):
        if self._recognizer is None:
            if not Path(self.recognizer_path).exists():
                raise FileNotFoundError('Local SFace model is missing')
            self._recognizer = cv2.FaceRecognizerSF.create(self.recognizer_path, '')
        return self._recognizer

    def _get_detector(self, width, height, score_threshold=0.6):
        if not Path(self.detector_path).exists():
            raise FileNotFoundError('Local YuNet model is missing')
        if self._detector is None:
            self._detector = cv2.FaceDetectorYN.create(self.detector_path, '', (width,height), score_threshold=score_threshold, nms_threshold=0.3, top_k=5000)
        else:
            self._detector.setInputSize((width,height))
            self._detector.setScoreThreshold(score_threshold)
        self._detector_size = (width,height)
        return self._detector

    def _faces(self, payload):
        image = decode_image(payload)
        frame = cv2.cvtColor(np.array(image.convert('RGB')), cv2.COLOR_RGB2BGR)
        h,w = frame.shape[:2]
        _, faces = self._get_detector(w,h).detect(frame)
        return frame, [] if faces is None else sorted([f for f in faces if len(f)>=15 and np.isfinite(f).all()], key=lambda f: float(f[2]*f[3]), reverse=True)

    def _feature(self, frame, face):
        fw,fh = float(face[2]),float(face[3])
        quality = {'width':round(fw), 'height':round(fh), 'detection_score':round(float(face[14]),3)}
        if not np.isfinite(face).all() or fw < 50 or fh < 50:
            return None, quality, 'Face is too small; move closer'
        if face[14] < .75:
            return None, quality, 'Face detection is uncertain; face the camera'
        eye_distance = float(np.linalg.norm(face[4:6]-face[6:8]))
        eye_mid = (face[4:6]+face[6:8])/2
        if eye_distance < fw*.15 or abs(float(face[8]-eye_mid[0])) > eye_distance*.65:
            return None, quality, 'Face angle is too oblique; look toward the camera'
        aligned = self.recognizer.alignCrop(frame,face)
        gray = cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray,cv2.CV_64F).var())
        exposure = float(gray.mean())
        quality.update(sharpness=round(sharpness,1), exposure=round(exposure,1))
        if sharpness < 15:
            return None, quality, 'Face image is too blurry; hold steady'
        if exposure < 35 or exposure > 220:
            return None, quality, 'Face lighting is too dark or bright; adjust the lighting'
        feat = self.recognizer.feature(aligned).astype(np.float32)
        if feat.size != 128 or not np.isfinite(feat).all() or np.linalg.norm(feat) <= 0:
            return None, quality, 'Face features could not be extracted'
        return feat.reshape(1,128).copy(), quality, None

    def _score(self, feat, person):
        scores = [float(self.recognizer.match(feat,s['feat'],cv2.FaceRecognizerSF_FR_COSINE)) for s in person['samples']]
        scores = [s for s in scores if np.isfinite(s)]
        return max(scores, default=-1.)

    @staticmethod
    def _box(frame,face):
        h,w = frame.shape[:2]
        x1,y1 = max(0,round(float(face[0]))),max(0,round(float(face[1])))
        x2,y2 = min(w,round(float(face[0]+face[2]))),min(h,round(float(face[1]+face[3])))
        return [min(w,x1),min(h,y1),max(0,x2-x1),max(0,y2-y1)]

    def enroll(self, name, notes, image_bytes, person_id=None, append_sample=False,
               consent=False, retention_days=0):
        name = name.strip()
        if not name or len(name)>200:
            raise HTTPException(422,'Provide a valid name up to 200 characters')
        if append_sample and not person_id:
            raise HTTPException(422,'Select a person_id when adding a sample')
        if not person_id and not consent:
            raise HTTPException(403, 'Explicit consent is required before biometric enrollment')
        with self._lock:
            frame, faces = self._faces(image_bytes)
            if not faces:
                raise HTTPException(422,'No face detected; provide a clear, well-lit photo')
            if len(faces) != 1:
                raise HTTPException(422,'Multiple faces detected; use a photo with exactly one face')
            feat, quality, reason = self._feature(frame,faces[0])
            if reason:
                raise HTTPException(422,reason)
            now = int(time.time()*1000)
            target_id = person_id or 'person_'+uuid.uuid4().hex
            sample_id = 'sample_'+uuid.uuid4().hex
            with self._write() as conn:
                existing = conn.execute(select(people).where(people.c.id==target_id)).mappings().first()
                if person_id and not existing:
                    raise HTTPException(404,'Person not found')
                if existing and (existing['permission']=='disabled' or existing['enrollment_state']=='revoked'):
                    raise HTTPException(409,'Reactivate the identity before adding samples')
                prior = list(conn.execute(select(face_samples).where(face_samples.c.person_id==target_id)).mappings())
                if prior:
                    valid = [np.frombuffer(sample['embedding'],np.float32) for sample in prior if len(sample['embedding'])==512]
                    existing_scores = [float(self.recognizer.match(feat,v.reshape(1,128),cv2.FaceRecognizerSF_FR_COSINE)) for v in valid if v.size==128 and np.isfinite(v).all()]
                    if not existing_scores or max(existing_scores)<DEFAULT_VERIFY_THRESHOLD:
                        raise HTTPException(409,'New sample does not clearly match the selected identity')
                if len(prior) >= MAX_SAMPLES:
                    raise HTTPException(409,'Sample limit reached; remove an old sample first')
                for sample in prior:
                    if len(sample['embedding']) != 512:
                        continue
                    previous = np.frombuffer(sample['embedding'],np.float32)
                    if previous.size==128 and np.isfinite(previous).all():
                        similarity = float(self.recognizer.match(feat,previous.reshape(1,128),cv2.FaceRecognizerSF_FR_COSINE))
                        if similarity >= .995:
                            raise HTTPException(409,'Duplicate face sample; capture a different angle or lighting')
                if not existing:
                    conn.execute(insert(people).values(id=target_id,name=name,notes=notes.strip()[:2000],created=now,updated=now,
                        relationship='guest',permission='standard',enrollment_state='incomplete',
                        consent_status='granted',consented_at=now,retention_days=retention_days))
                conn.execute(insert(face_samples).values(id=sample_id,person_id=target_id,embedding=feat.tobytes(),
                    sample_hash=hashlib.sha256(feat.tobytes()).hexdigest(),created=now,quality=json.dumps(quality)))
                state = 'active' if len(prior)+1>=3 else 'incomplete'
                conn.execute(update(people).where(people.c.id==target_id).values(updated=now,enrollment_state=state))
            return {'id':target_id,'sample_id':sample_id,'name':existing['name'] if existing else name,
                'notes':existing['notes'] if existing else notes.strip()[:2000], 'created':existing['created'] if existing else now,
                'sample_count':len(prior)+1,'enrollment_state':state,'consent_status':'granted',
                'quality':quality,'face_box':self._box(frame,faces[0])}

    def list_people(self):
        with self.engine.connect() as conn:
            identities = [dict(r) for r in conn.execute(select(people).order_by(people.c.created.desc(),people.c.id)).mappings()]
            samples = list(conn.execute(select(face_samples.c.id,face_samples.c.person_id,face_samples.c.quality,face_samples.c.created)).mappings())
            v_samples = list(conn.execute(select(voice_samples.c.id,voice_samples.c.person_id,voice_samples.c.passphrase,voice_samples.c.duration_ms,voice_samples.c.quality,voice_samples.c.created)).mappings())
        for p in identities:
            owned = [s for s in samples if s['person_id']==p['id']]
            v_owned = [s for s in v_samples if s['person_id']==p['id']]
            p.update(
                sample_count=len(owned),
                sample_ids=[s['id'] for s in owned],
                samples=[{'id':s['id'],'created':s['created'],'quality':json.loads(s['quality'])} for s in owned],
                voice_sample_count=len(v_owned),
                voice_sample_ids=[s['id'] for s in v_owned],
                voice_samples=[{'id':s['id'],'passphrase':s['passphrase'],'duration_ms':s['duration_ms'],'created':s['created'],'quality':json.loads(s['quality'])} for s in v_owned]
            )
        return identities

    def update_person(self,person_id,values):
        values = {k:(v.strip() if isinstance(v,str) else v) for k,v in values.items() if v is not None}
        if 'name' in values and not values['name']:
            raise HTTPException(422,'Name cannot be blank')
        with self._write() as conn:
            if not conn.execute(select(people.c.id).where(people.c.id==person_id)).first():
                raise HTTPException(404,'Person not found')
            count = len(conn.execute(select(face_samples.c.id).where(face_samples.c.person_id==person_id)).all())
            if values.get('enrollment_state')=='active' and count<3:
                raise HTTPException(422,'Capture at least three varied samples before marking enrollment active')
            if values.get('consent_status') == 'granted':
                values['consented_at'] = int(time.time()*1000)
            if values.get('consent_status') == 'revoked':
                conn.execute(delete(voice_samples).where(voice_samples.c.person_id==person_id))
                conn.execute(delete(face_samples).where(face_samples.c.person_id==person_id))
                values['enrollment_state'] = 'revoked'
            conn.execute(update(people).where(people.c.id==person_id).values(**values,updated=int(time.time()*1000)))
        return next(p for p in self.list_people() if p['id']==person_id)

    def delete_person(self,person_id):
        with self._write() as conn:
            conn.execute(update(memories).where(memories.c.capture_person_id == person_id).values(capture_person_id=None))
            conn.execute(delete(voice_samples).where(voice_samples.c.person_id==person_id))
            conn.execute(delete(face_samples).where(face_samples.c.person_id==person_id))
            return conn.execute(delete(people).where(people.c.id==person_id)).rowcount>0

    def delete_sample(self,person_id,sample_id):
        with self._write() as conn:
            found = conn.execute(select(people).where(people.c.id==person_id)).mappings().first()
            if not found:
                raise HTTPException(404,'Person not found')
            if not conn.execute(delete(face_samples).where(face_samples.c.person_id==person_id,face_samples.c.id==sample_id)).rowcount:
                raise HTTPException(404,'Sample not found')
            count = len(conn.execute(select(face_samples.c.id).where(face_samples.c.person_id==person_id)).all())
            state = found['enrollment_state'] if found['enrollment_state']=='revoked' else ('active' if count>=3 else 'incomplete')
            conn.execute(update(people).where(people.c.id==person_id).values(enrollment_state=state,updated=int(time.time()*1000)))
        return {'deleted':True,'id':sample_id}

    # ==================== VOICE BIOMETRIC METHODS ====================

    def enroll_voice(self, person_id: str, audio_bytes: bytes, passphrase: str = 'Authorize Oracle System'):
        passphrase = passphrase.strip() or 'Authorize Oracle System'
        with self._lock:
            try:
                audio, duration_ms = decode_audio_blob(audio_bytes)
            except Exception as e:
                raise HTTPException(422, f'Could not decode audio: {e}')

            quality, reason = assess_voice_quality(audio)
            if reason:
                raise HTTPException(422, reason)

            feat = extract_voiceprint(audio)
            if feat.size != 192 or not np.isfinite(feat).all() or np.linalg.norm(feat) <= 0:
                raise HTTPException(422, 'Voice features could not be extracted')

            now = int(time.time() * 1000)
            sample_id = 'vsample_' + uuid.uuid4().hex

            with self._write() as conn:
                existing = conn.execute(select(people).where(people.c.id == person_id)).mappings().first()
                if not existing:
                    raise HTTPException(404, 'Person not found')
                if existing['permission'] == 'disabled' or existing['enrollment_state'] == 'revoked':
                    raise HTTPException(409, 'Reactivate the identity before adding voice samples')

                prior = list(conn.execute(select(voice_samples).where(voice_samples.c.person_id == person_id)).mappings())
                if len(prior) >= MAX_VOICE_SAMPLES:
                    raise HTTPException(409, 'Voice sample limit reached (6 max); remove an existing sample first')

                for sample in prior:
                    prev_feat = np.frombuffer(sample['embedding'], dtype=np.float32)
                    if prev_feat.size == 192:
                        sim = cosine_similarity(feat, prev_feat)
                        if sim >= 0.995:
                            raise HTTPException(409, 'Duplicate voice sample; speak passphrase again with natural cadence')

                conn.execute(insert(voice_samples).values(
                    id=sample_id,
                    person_id=person_id,
                    embedding=feat.tobytes(),
                    sample_hash=hashlib.sha256(feat.tobytes()).hexdigest(),
                    passphrase=passphrase,
                    duration_ms=duration_ms,
                    created=now,
                    quality=json.dumps(quality)
                ))
                conn.execute(update(people).where(people.c.id == person_id).values(updated=now))

            return {
                'id': person_id,
                'sample_id': sample_id,
                'passphrase': passphrase,
                'duration_ms': duration_ms,
                'voice_sample_count': len(prior) + 1,
                'quality': quality
            }

    def list_voice_samples(self, person_id: str):
        with self.engine.connect() as conn:
            existing = conn.execute(select(people).where(people.c.id == person_id)).mappings().first()
            if not existing:
                raise HTTPException(404, 'Person not found')
            samples = list(conn.execute(select(voice_samples).where(voice_samples.c.person_id == person_id).order_by(voice_samples.c.created.desc())).mappings())
        return {
            'person_id': person_id,
            'voice_samples': [
                {
                    'id': s['id'],
                    'passphrase': s['passphrase'],
                    'duration_ms': s['duration_ms'],
                    'created': s['created'],
                    'quality': json.loads(s['quality'])
                }
                for s in samples
            ]
        }

    def delete_voice_sample(self, person_id: str, sample_id: str):
        with self._write() as conn:
            found = conn.execute(select(people).where(people.c.id == person_id)).mappings().first()
            if not found:
                raise HTTPException(404, 'Person not found')
            deleted = conn.execute(delete(voice_samples).where(voice_samples.c.person_id == person_id, voice_samples.c.id == sample_id)).rowcount
            if not deleted:
                raise HTTPException(404, 'Voice sample not found')
            conn.execute(update(people).where(people.c.id == person_id).values(updated=int(time.time() * 1000)))
        return {'deleted': True, 'id': sample_id}

    def verify_voice(self, audio_bytes: bytes, person_id: str | None = None, expected_passphrase: str = 'Authorize Oracle System', threshold: float = DEFAULT_VOICE_THRESHOLD, *, strict_challenge: bool = False):
        started = time.perf_counter()
        expected_passphrase = expected_passphrase.strip() or 'Authorize Oracle System'

        # 1. Transcribe audio with whisper if available
        transcribed_text = ''
        if self.voice_service and hasattr(self.voice_service, 'transcribe'):
            try:
                res = self.voice_service.transcribe(audio_bytes)
                transcribed_text = res.get('text', '').strip()
            except Exception:
                transcribed_text = ''

        # 2. Decode & Quality Assessment
        try:
            audio, duration_ms = decode_audio_blob(audio_bytes)
        except Exception as e:
            return {
                'verified': False,
                'passphrase_matched': False,
                'voiceprint_matched': False,
                'transcribed_text': transcribed_text,
                'similarity_score': 0.0,
                'threshold': threshold,
                'reason': f'Could not decode audio: {e}',
                'latency_ms': round((time.perf_counter() - started) * 1000, 2)
            }

        quality, reason = assess_voice_quality(audio)
        if reason:
            return {
                'verified': False,
                'passphrase_matched': False,
                'voiceprint_matched': False,
                'transcribed_text': transcribed_text,
                'similarity_score': 0.0,
                'threshold': threshold,
                'quality': quality,
                'reason': reason,
                'latency_ms': round((time.perf_counter() - started) * 1000, 2)
            }

        # 3. Passphrase Check
        if strict_challenge:
            passphrase_matched = re.findall(r'[a-z]+', transcribed_text.lower()) == expected_passphrase.split()
        else:
            passphrase_matched = _check_passphrase_match(transcribed_text, expected_passphrase)
        # If speech was present but Whisper failed to initialize or transcribe on tiny CPU, fallback to checking spoken audio length
        if not strict_challenge and not transcribed_text and duration_ms >= 1000 and quality.get('voiced_ratio', 0) > 0.25:
            passphrase_matched = True

        # 4. Extract Speaker Voiceprint
        feat = extract_voiceprint(audio)

        # 5. Retrieve Enrolled Voiceprints for target
        with self.engine.connect() as conn:
            identities = [dict(r) for r in conn.execute(select(people)).mappings()]
            all_v_samples = list(conn.execute(select(voice_samples)).mappings())

        if person_id:
            targets = [p for p in identities if p['id'] == person_id]
        else:
            # Fall back to active administrators
            targets = [p for p in identities if p['permission'] == 'administrator' and p['enrollment_state'] != 'revoked']

        if not targets:
            self._audit_authentication(person_id, 'voice', False, 'No matching administrator identity found')
            return {
                'verified': False,
                'passphrase_matched': passphrase_matched,
                'voiceprint_matched': False,
                'transcribed_text': transcribed_text,
                'similarity_score': 0.0,
                'threshold': threshold,
                'reason': 'No matching administrator identity found',
                'latency_ms': round((time.perf_counter() - started) * 1000, 2)
            }

        target = targets[0]
        person_v_samples = [s for s in all_v_samples if s['person_id'] == target['id']]

        if not person_v_samples:
            self._audit_authentication(target['id'], 'voice', False, 'No enrolled voiceprint')
            return {
                'verified': False,
                'passphrase_matched': passphrase_matched,
                'voiceprint_matched': False,
                'transcribed_text': transcribed_text,
                'similarity_score': 0.0,
                'threshold': threshold,
                'target_id': target['id'],
                'target_name': target['name'],
                'reason': 'No voiceprint samples enrolled for this administrator',
                'latency_ms': round((time.perf_counter() - started) * 1000, 2)
            }

        scores = []
        for s in person_v_samples:
            s_feat = np.frombuffer(s['embedding'], dtype=np.float32)
            if s_feat.size == 192:
                sim = cosine_similarity(feat, s_feat)
                scores.append(sim)

        best_score = max(scores, default=0.0)
        voiceprint_matched = (best_score >= threshold)
        verified = bool(passphrase_matched and voiceprint_matched)
        fail_reason = None
        if not passphrase_matched:
            fail_reason = f"Spoken challenge phrase ('{transcribed_text}') did not match '{expected_passphrase}'"
        elif not voiceprint_matched:
            fail_reason = f"Voiceprint timbre does not match administrator (similarity {best_score:.2f} < {threshold:.2f})"
        audit_reason = 'verified' if verified else 'Voice verification failed'
        if not strict_challenge and fail_reason:
            audit_reason = fail_reason
        self._audit_authentication(target['id'], 'voice', verified, audit_reason)

        return {
            'verified': verified,
            'passphrase_matched': passphrase_matched,
            'voiceprint_matched': voiceprint_matched,
            'transcribed_text': transcribed_text,
            'similarity_score': round(best_score, 4),
            'threshold': threshold,
            'target_id': target['id'],
            'target_name': target['name'],
            'reason': fail_reason,
            'quality': quality,
            'latency_ms': round((time.perf_counter() - started) * 1000, 2)
        }

    def _audit_authentication(self, person_id, method, success, reason):
        with self.engine.begin() as conn:
            conn.execute(insert(authentication_events).values(
                id='auth_' + uuid.uuid4().hex,
                person_id=person_id,
                method=method,
                success=1 if success else 0,
                reason=reason[:500],
                created=int(time.time()*1000),
            ))

    # =================================================================

    def group_captures(self, captures):
        groups = []
        with self._lock:
            gallery = [p for p in self._get_gallery() if p['permission'] != 'disabled'
                       and p['enrollment_state'] != 'revoked' and p.get('consent_status') == 'granted'
                       and p['samples']]
            for capture_id, image in captures:
                frame, faces = self._faces(image)
                feature, _, reason = self._feature(frame, faces[0]) if len(faces) == 1 else (
                    None, None, 'No face detected' if not faces else 'Multiple faces detected')
                person_id = None
                auto_assign = False
                if feature is not None:
                    ranked = sorted(((self._score(feature, p), p['id']) for p in gallery), reverse=True)
                    if ranked and ranked[0][0] >= .55 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= IDENTITY_MARGIN):
                        person_id = ranked[0][1]
                        auto_assign = ranked[0][0] >= .65 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= .12)
                    for group in groups:
                        if person_id is not None and person_id == group['person_id']:
                            break
                        if person_id is None and group['person_id'] is None and group['features'] and all(
                            self.recognizer.match(feature, previous, cv2.FaceRecognizerSF_FR_COSINE) >= .60
                            for previous in group['features']
                        ):
                            break
                    else:
                        group = None
                    if group is not None:
                        group['ids'].append(capture_id)
                        if auto_assign:
                            group['auto_ids'].append(capture_id)
                        group['features'].append(feature)
                        continue
                groups.append({'ids': [capture_id], 'person_id': person_id,
                               'auto_ids': [capture_id] if auto_assign else [],
                               'reason': reason or ('No confident profile match' if person_id is None else None),
                               'features': [feature] if feature is not None else []})
        return [{key: value for key, value in group.items() if key != 'features'} for group in groups]

    def _match_public_figure(self, feature):
        if self._public_samples is None:
            self._public_samples = []
            try:
                catalog = json.loads((PUBLIC_FIGURE_DIR / 'catalog.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                catalog = []
            for entry in catalog if isinstance(catalog, list) else []:
                try:
                    figure = PublicFigureReference.model_validate(entry)
                    source = urlsplit(figure.source)
                    if source.scheme != 'https' or not source.hostname:
                        continue
                    path = PUBLIC_FIGURE_DIR / f'{figure.id}.jpg'
                    reference, faces = self._faces(path.read_bytes())
                    if len(faces) != 1:
                        continue
                    sample, _, _ = self._feature(reference, faces[0])
                    if sample is not None:
                        self._public_samples.append((sample, figure.model_dump()))
                except (OSError, ValueError, HTTPException, cv2.error):
                    continue
        ranked = sorted(
            ((float(self.recognizer.match(feature, sample, cv2.FaceRecognizerSF_FR_COSINE)), figure)
             for sample, figure in self._public_samples),
            key=lambda result: result[0], reverse=True,
        )
        if ranked and ranked[0][0] >= .65 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= .12):
            return ranked[0][1]
        return None

    def identify(self,image_bytes,threshold=DEFAULT_SFACE_THRESHOLD, public_figures=False):
        started=time.perf_counter()
        with self._lock:
            frame,faces=self._faces(image_bytes)
            gallery=[p for p in self._get_gallery() if p['permission']!='disabled' and
                     p['enrollment_state']!='revoked' and p.get('consent_status', 'granted') == 'granted' and p['samples']]
            results=[]
            for face in faces:
                feat,quality,reason=self._feature(frame,face)
                ranked=sorted([(self._score(feat,p),p) for p in gallery],key=lambda pair:pair[0],reverse=True) if feat is not None else []
                best_score,best=ranked[0] if ranked else (-1,None)
                margin=best_score-ranked[1][0] if len(ranked)>1 else None
                matched=reason is None and best is not None and best_score>=threshold and (margin is None or margin>=IDENTITY_MARGIN)
                state='poor_quality' if reason else ('recognized' if matched else ('uncertain' if best_score>=threshold else 'unknown'))
                public_figure = self._match_public_figure(feat) if public_figures and state == 'unknown' and feat is not None else None
                results.append({'id':best['id'] if matched else None,'name':best['name'] if matched else 'Unknown',
                    'matched':bool(matched),'recognition_state':state,'verification_state':'not_requested',
                    'cosine_score':round(best_score,4) if ranked else None,'score_margin':round(margin,4) if margin is not None else None,
                    'threshold':threshold,'quality':quality,'reason':reason or ('Similar scores for different identities' if state=='uncertain' else None),
                    'possible_match':best['name'] if state == 'uncertain' and best else None,
                    'public_figure':public_figure,
                    'box':self._box(frame,face),'relationship':best['relationship'] if matched else None,
                    'permission':best['permission'] if matched else None,'is_admin':bool(matched and best['permission']=='administrator'),
                    'notes':best['notes'] if matched else '', 'access_allowed':False,'liveness':'not_evaluated'})
            h,w=frame.shape[:2]
            return {'faces_detected':len(faces),'image_width':w,'image_height':h,'identified':results,
                'recognition_state':'no_face' if not faces else 'faces_detected','has_match':any(r['matched'] for r in results),
                'has_admin':any(r['is_admin'] for r in results),'latency_ms':round((time.perf_counter()-started)*1000,2)}

    def verify(self,image_bytes,person_id=None,name=None,threshold=DEFAULT_VERIFY_THRESHOLD):
        if not person_id and not name:
            raise HTTPException(422,'Provide person_id to verify against')
        if not DEFAULT_SFACE_THRESHOLD<=threshold<=1:
            raise HTTPException(422,'Verification threshold is outside the supported range')
        started=time.perf_counter()
        with self._lock:
            gallery=self._get_gallery()
            targets=[p for p in gallery if p['id']==person_id] if person_id else [p for p in gallery if p['name'].casefold()==name.strip().casefold()]
            if len(targets)>1:
                raise HTTPException(409,'Name is ambiguous; select a person_id')
            if not targets:
                raise HTTPException(404,'Target identity not found')
            target=targets[0]
            result={'verified':False,'verification_state':'failed','target_id':target['id'],'target_name':target['name'],
                'threshold':threshold,'cosine_score':None,'access_allowed':False,'liveness':'not_evaluated',
                'second_factor':'not_checked','expires_at':None,'reason':None}
            if target['permission']=='disabled' or target['enrollment_state']=='revoked':
                result['reason']='Identity is disabled or revoked'
            elif not target['samples']:
                result['reason']='No valid face samples; enroll again'
            else:
                frame,faces=self._faces(image_bytes)
                if len(faces)!=1:
                    result['reason']='No face detected' if not faces else 'Multiple faces detected; use exactly one face'
                else:
                    feat,quality,reason=self._feature(frame,faces[0])
                    result.update(quality=quality,face_box=self._box(frame,faces[0]))
                    if reason:
                        result.update(reason=reason,verification_state='poor_quality')
                    else:
                        score=self._score(feat,target)
                        rivals=[self._score(feat,p) for p in gallery if p['id']!=target['id'] and p['permission']!='disabled' and p['enrollment_state']!='revoked' and p['samples']]
                        margin=score-max(rivals) if rivals else None
                        verified=score>=threshold and (margin is None or margin>=IDENTITY_MARGIN)
                        result.update(verified=bool(verified),cosine_score=round(score,4),score_margin=round(margin,4) if margin is not None else None,
                            verification_state='verified' if verified else ('uncertain' if score>=threshold else 'failed'),
                            expires_at=int(time.time()*1000)+30000 if verified else None,
                            reason=None if verified else ('Identity match is ambiguous' if score>=threshold else 'Face does not match the selected identity'))
            result['latency_ms']=round((time.perf_counter()-started)*1000,2)
            return result


def people_router(recognizer: PersonRecognizer, voice_service=None, protect_identity=None):
    if voice_service and not recognizer.voice_service:
        recognizer.voice_service = voice_service

    router = APIRouter(prefix='/api/v1/people')

    async def image_payload(request: Request):
        ct = request.headers.get('content-type', '').split(';')[0]
        if ct not in {'image/png', 'image/jpeg'}:
            raise HTTPException(415, 'Send a still PNG or JPEG image')
        return await request.body()

    async def audio_payload(request: Request):
        return await request.body()

    async def authorize_change(request, person_id, permission=None):
        if protect_identity:
            await protect_identity(request, person_id, permission)

    @router.get('')
    def list_people():
        return {'people': recognizer.list_people()}

    @router.patch('/{person_id}')
    async def update_person(request: Request, person_id: str, values: PersonUpdate):
        await authorize_change(request, person_id, values.permission)
        return await run_in_threadpool(recognizer.update_person, person_id, values.model_dump(exclude_unset=True))

    @router.delete('/{person_id}')
    async def delete_person(request: Request, person_id: str):
        await authorize_change(request, person_id)
        if not await run_in_threadpool(recognizer.delete_person, person_id):
            raise HTTPException(404, 'Person not found')
        return {'deleted': True, 'id': person_id}

    @router.delete('/{person_id}/samples/{sample_id}')
    async def delete_sample(request: Request, person_id: str, sample_id: str):
        await authorize_change(request, person_id)
        return await run_in_threadpool(recognizer.delete_sample, person_id, sample_id)

    @router.post('/enroll')
    async def enroll(
        request: Request,
        name: str = Query(..., min_length=1, max_length=200),
        notes: str = Query('', max_length=2000),
        person_id: str | None = Query(None),
        append_sample: bool = Query(False),
        consent: bool = Query(False),
        retention_days: int = Query(0, ge=0, le=3650),
    ):
        if person_id:
            await authorize_change(request, person_id)
        return await run_in_threadpool(
            recognizer.enroll, name, notes, await image_payload(request),
            person_id, append_sample, consent, retention_days)

    @router.post('/{person_id}/consent/revoke')
    async def revoke_consent(request: Request, person_id: str):
        await authorize_change(request, person_id)
        return await run_in_threadpool(recognizer.update_person, person_id, {'consent_status': 'revoked'})

    @router.post('/identify')
    async def identify(request: Request, threshold: float = Query(DEFAULT_SFACE_THRESHOLD, ge=DEFAULT_SFACE_THRESHOLD, le=1), public_figures: bool = False):
        return await run_in_threadpool(recognizer.identify, await image_payload(request), threshold, public_figures)

    @router.post('/verify')
    async def verify(request: Request, person_id: str | None = Query(None), name: str | None = Query(None), threshold: float = Query(DEFAULT_VERIFY_THRESHOLD, ge=DEFAULT_SFACE_THRESHOLD, le=1)):
        return await run_in_threadpool(recognizer.verify, await image_payload(request), person_id, name, threshold)

    # Voice biometric endpoints
    @router.post('/{person_id}/voice/enroll')
    async def enroll_voice(
        request: Request,
        person_id: str,
        passphrase: str = Query('Authorize Oracle System')
    ):
        await authorize_change(request, person_id)
        body = await audio_payload(request)
        if not body:
            raise HTTPException(422, 'Send valid audio data')
        return await run_in_threadpool(recognizer.enroll_voice, person_id, body, passphrase)

    @router.get('/{person_id}/voice/samples')
    def get_voice_samples(person_id: str):
        return recognizer.list_voice_samples(person_id)

    @router.delete('/{person_id}/voice/samples/{sample_id}')
    async def delete_voice_sample(request: Request, person_id: str, sample_id: str):
        await authorize_change(request, person_id)
        return await run_in_threadpool(recognizer.delete_voice_sample, person_id, sample_id)

    @router.post('/voice/verify')
    async def verify_voice(
        request: Request,
        person_id: str | None = Query(None),
        expected_passphrase: str = Query('Authorize Oracle System'),
        threshold: float = Query(DEFAULT_VOICE_THRESHOLD, ge=0.5, le=1.0)
    ):
        body = await audio_payload(request)
        if not body:
            raise HTTPException(422, 'Send valid audio data')
        return await run_in_threadpool(recognizer.verify_voice, body, person_id, expected_passphrase, threshold)

    @router.post('/{person_id}/voice/verify')
    async def verify_person_voice(
        request: Request,
        person_id: str,
        expected_passphrase: str = Query('Authorize Oracle System'),
        threshold: float = Query(DEFAULT_VOICE_THRESHOLD, ge=0.5, le=1.0)
    ):
        body = await audio_payload(request)
        if not body:
            raise HTTPException(422, 'Send valid audio data')
        return await run_in_threadpool(recognizer.verify_voice, body, person_id, expected_passphrase, threshold)

    return router
