"""Local face matching. A biometric match never grants access or proves liveness."""
import hashlib
import json
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, insert, select, update
from starlette.concurrency import run_in_threadpool
from .database import people, face_samples, locks
from .reading import decode_image

YUNET_PATH = Path(__file__).resolve().parents[2] / 'models/vision/face_detection_yunet.onnx'
SFACE_PATH = Path(__file__).resolve().parents[2] / 'models/vision/face_recognition_sface.onnx'
DEFAULT_SFACE_THRESHOLD = 0.363
DEFAULT_VERIFY_THRESHOLD = 0.45
IDENTITY_MARGIN = 0.05
MAX_SAMPLES = 12

class PersonUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    notes: str | None = Field(None, max_length=2000)
    relationship: Literal['owner', 'family', 'friend', 'colleague', 'guest'] | None = None
    permission: Literal['standard', 'administrator', 'disabled'] | None = None
    enrollment_state: Literal['incomplete', 'active', 'needs_new_samples', 'revoked'] | None = None

class PersonRecognizer:
    def __init__(self, engine, detector_path=None, recognizer_path=None):
        self.engine = engine
        self.detector_path = str(detector_path or YUNET_PATH)
        self.recognizer_path = str(recognizer_path or SFACE_PATH)
        self._recognizer = None
        self._detector = None
        self._detector_size = None
        self._lock = threading.RLock()

    @contextmanager
    def _write(self):
        # Serializes mutations across processes on PostgreSQL and SQLite.
        with self.engine.begin() as conn:
            conn.execute(update(locks).where(locks.c.name == 'enrolled_people').values(name='enrolled_people'))
            yield conn

    def _get_gallery(self):
        # Fresh snapshots avoid stale enrollment/permission caches across workers.
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
        # Landmark geometry is a coarse pose/alignment check, not an occlusion detector.
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
        # Best enrolled view; this heuristic must be evaluated with the deployed gallery.
        return max(scores, default=-1.)

    @staticmethod
    def _box(frame,face):
        h,w = frame.shape[:2]
        x1,y1 = max(0,round(float(face[0]))),max(0,round(float(face[1])))
        x2,y2 = min(w,round(float(face[0]+face[2]))),min(h,round(float(face[1]+face[3])))
        return [min(w,x1),min(h,y1),max(0,x2-x1),max(0,y2-y1)]

    def enroll(self, name, notes, image_bytes, person_id=None, append_sample=False):
        name = name.strip()
        if not name or len(name)>200:
            raise HTTPException(422,'Provide a valid name up to 200 characters')
        if append_sample and not person_id:
            raise HTTPException(422,'Select a person_id when adding a sample')
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
                        relationship='guest',permission='standard',enrollment_state='incomplete'))
                conn.execute(insert(face_samples).values(id=sample_id,person_id=target_id,embedding=feat.tobytes(),
                    sample_hash=hashlib.sha256(feat.tobytes()).hexdigest(),created=now,quality=json.dumps(quality)))
                state = 'active' if len(prior)+1>=3 else 'incomplete'
                conn.execute(update(people).where(people.c.id==target_id).values(updated=now,enrollment_state=state))
            return {'id':target_id,'sample_id':sample_id,'name':existing['name'] if existing else name,
                'notes':existing['notes'] if existing else notes.strip()[:2000], 'created':existing['created'] if existing else now,
                'sample_count':len(prior)+1,'enrollment_state':state,'quality':quality,'face_box':self._box(frame,faces[0])}

    def list_people(self):
        with self.engine.connect() as conn:
            identities = [dict(r) for r in conn.execute(select(people).order_by(people.c.created.desc(),people.c.id)).mappings()]
            samples = list(conn.execute(select(face_samples.c.id,face_samples.c.person_id,face_samples.c.quality,face_samples.c.created)).mappings())
        for p in identities:
            owned = [s for s in samples if s['person_id']==p['id']]
            p.update(sample_count=len(owned),sample_ids=[s['id'] for s in owned],
                samples=[{'id':s['id'],'created':s['created'],'quality':json.loads(s['quality'])} for s in owned])
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
            conn.execute(update(people).where(people.c.id==person_id).values(**values,updated=int(time.time()*1000)))
        return next(p for p in self.list_people() if p['id']==person_id)

    def delete_person(self,person_id):
        with self._write() as conn:
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

    def identify(self,image_bytes,threshold=DEFAULT_SFACE_THRESHOLD):
        started=time.perf_counter()
        with self._lock:
            frame,faces=self._faces(image_bytes)
            gallery=[p for p in self._get_gallery() if p['permission']!='disabled' and p['enrollment_state']!='revoked' and p['samples']]
            results=[]
            for face in faces:
                feat,quality,reason=self._feature(frame,face)
                ranked=sorted([(self._score(feat,p),p) for p in gallery],key=lambda pair:pair[0],reverse=True) if feat is not None else []
                best_score,best=ranked[0] if ranked else (-1,None)
                margin=best_score-ranked[1][0] if len(ranked)>1 else None
                matched=reason is None and best is not None and best_score>=threshold and (margin is None or margin>=IDENTITY_MARGIN)
                state='poor_quality' if reason else ('recognized' if matched else ('uncertain' if best_score>=threshold else 'unknown'))
                results.append({'id':best['id'] if matched else None,'name':best['name'] if matched else 'Unknown',
                    'matched':bool(matched),'recognition_state':state,'verification_state':'not_requested',
                    'cosine_score':round(best_score,4) if ranked else None,'score_margin':round(margin,4) if margin is not None else None,
                    'threshold':threshold,'quality':quality,'reason':reason or ('Similar scores for different identities' if state=='uncertain' else None),
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

def people_router(recognizer):
    router=APIRouter(prefix='/api/v1/people')
    async def payload(request):
        if request.headers.get('content-type','').split(';')[0] not in {'image/png','image/jpeg'}:
            raise HTTPException(415,'Send a still PNG or JPEG image')
        return await request.body()
    @router.get('')
    def list_people():
        return {'people':recognizer.list_people()}
    @router.patch('/{person_id}')
    def update_person(person_id:str,values:PersonUpdate):
        return recognizer.update_person(person_id,values.model_dump(exclude_unset=True))
    @router.delete('/{person_id}')
    def delete_person(person_id:str):
        if not recognizer.delete_person(person_id):
            raise HTTPException(404,'Person not found')
        return {'deleted':True,'id':person_id}
    @router.delete('/{person_id}/samples/{sample_id}')
    def delete_sample(person_id:str,sample_id:str):
        return recognizer.delete_sample(person_id,sample_id)
    @router.post('/enroll')
    async def enroll(request:Request,name:str=Query(...,min_length=1,max_length=200),notes:str=Query('',max_length=2000),person_id:str|None=Query(None),append_sample:bool=Query(False)):
        return await run_in_threadpool(recognizer.enroll,name,notes,await payload(request),person_id,append_sample)
    @router.post('/identify')
    async def identify(request:Request,threshold:float=Query(DEFAULT_SFACE_THRESHOLD,ge=DEFAULT_SFACE_THRESHOLD,le=1)):
        return await run_in_threadpool(recognizer.identify,await payload(request),threshold)
    @router.post('/verify')
    async def verify(request:Request,person_id:str|None=Query(None),name:str|None=Query(None),threshold:float=Query(DEFAULT_VERIFY_THRESHOLD,ge=DEFAULT_SFACE_THRESHOLD,le=1)):
        return await run_in_threadpool(recognizer.verify,await payload(request),person_id,name,threshold)
    return router
