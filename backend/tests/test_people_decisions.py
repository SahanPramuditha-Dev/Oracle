"""Decision and migration checks independent of face model accuracy."""
import time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from sqlalchemy import inspect, text
from app.database import ROOT, database_engine, migrate
from app.people import PersonRecognizer

class FakeModel:
    def __init__(self): self.feat=np.eye(1,128,dtype=np.float32)
    def alignCrop(self,frame,face): return frame[:112,:112]
    def feature(self,aligned): return self.feat.copy()
    def match(self,a,b,kind): return float(np.dot(a.ravel(),b.ravel())/(np.linalg.norm(a)*np.linalg.norm(b)))

@pytest.fixture
def synthetic(tmp_path):
    engine=database_engine(tmp_path/'faces.db');migrate(engine)
    r=PersonRecognizer(engine);r._recognizer=FakeModel()
    frame=np.random.default_rng(1).integers(40,210,(160,160,3),dtype=np.uint8)
    face=np.array([10,10,110,120,45,45,85,45,65,65,48,95,82,95,.99],dtype=np.float32)
    r._faces=lambda payload:(frame,[face.copy()])
    return r,frame,face

def feature(angle):
    f=np.zeros((1,128),np.float32);f[0,0]=np.cos(angle);f[0,1]=np.sin(angle);return f

def test_all_views_belong_to_one_identity_and_best_view_verifies(synthetic):
    r,_,_=synthetic
    pid=r.enroll('One','notes',b'')['id']
    for angle in [.6,1.]:
        r._recognizer.feat=feature(angle);r.enroll('Ignored','ignored',b'',pid,True)
    identities=r.list_people()
    assert len(identities)==1 and identities[0]['sample_count']==3
    assert identities[0]['enrollment_state']=='active' and identities[0]['name']=='One'
    assert identities[0]['notes']=='notes'
    assert r.verify(b'',pid,threshold=.9)['verified']
    assert r.identify(b'')['identified'][0]['id']==pid
    assert all('embedding' not in s for s in identities[0]['samples'])

def test_add_sample_rejects_different_identity(synthetic):
    r,_,_=synthetic;pid=r.enroll('One','',b'')['id'];r._recognizer.feat=feature(2.)
    with pytest.raises(HTTPException,match='does not clearly match'): r.enroll('One','',b'',pid,True)
    assert r.list_people()[0]['sample_count']==1

def test_multiple_faces_rejected(synthetic):
    r,frame,face=synthetic;pid=r.enroll('One','',b'')['id']
    r._faces=lambda payload:(frame,[face.copy(),face.copy()])
    with pytest.raises(HTTPException,match='Multiple faces'): r.enroll('Two','',b'')
    assert not r.verify(b'',pid)['verified']
    assert 'Multiple faces' in r.verify(b'',pid)['reason']

def test_quality_gate_applies_to_all_operations(synthetic):
    r,frame,face=synthetic;pid=r.enroll('One','',b'')['id'];frame[:]=0
    with pytest.raises(HTTPException): r.enroll('Two','',b'')
    assert r.identify(b'')['identified'][0]['recognition_state']=='poor_quality'
    assert r.verify(b'',pid)['verification_state']=='poor_quality'

def test_tiny_and_oblique_faces_rejected(synthetic):
    r,frame,face=synthetic;small=face.copy();small[2]=20
    assert r._feature(frame,small)[0] is None
    oblique=face.copy();oblique[8]=120
    assert r._feature(frame,oblique)[0] is None

def test_invalid_embedding_ignored(synthetic):
    r,_,_=synthetic;pid=r.enroll('One','',b'')['id']
    with r.engine.begin() as conn: conn.execute(text('UPDATE face_samples SET embedding=:embedding'),{'embedding':b'broken'})
    assert not r.identify(b'')['has_match'] and not r.verify(b'',pid)['verified']

def test_gallery_reloads_revocations(synthetic):
    r,_,_=synthetic;pid=r.enroll('One','',b'')['id'];r._get_gallery()
    PersonRecognizer(r.engine).update_person(pid,{'permission':'disabled'})
    assert not r.identify(b'')['has_match']

def test_inference_serialized(synthetic):
    r,frame,face=synthetic;state={'active':0,'peak':0}
    def faces(payload):
        state['active']+=1;state['peak']=max(state['peak'],state['active']);time.sleep(.03);state['active']-=1
        return frame,[face.copy()]
    r._faces=faces
    with ThreadPoolExecutor(max_workers=4) as executor: list(executor.map(r.identify,[b'']*8))
    assert state['peak']==1

def test_legacy_migration_preserves_ids_and_samples(tmp_path):
    engine=database_engine(tmp_path/'legacy.db');config=Config()
    config.set_main_option('script_location',str(ROOT/'backend/migrations'))
    with engine.begin() as conn:
        config.attributes['connection']=conn;command.upgrade(config,'0003_enrolled_people')
        for pid in ['first','second']:
            conn.execute(text('INSERT INTO enrolled_people(id,name,notes,created,updated,embedding) VALUES(:id,:name,:notes,1,1,:embedding)'),{'id':pid,'name':'Same','notes':'ROOT ADMIN SAHAN','embedding':feature(0).tobytes()})
    migrate(engine);r=PersonRecognizer(engine);rows=r.list_people()
    assert {p['id'] for p in rows}=={'first','second'}
    assert all(p['permission']=='standard' and p['sample_count']==1 and p['enrollment_state']=='needs_new_samples' for p in rows)
    assert 'embedding' not in {c['name'] for c in inspect(engine).get_columns('enrolled_people')}
    assert all(np.array_equal(p['samples'][0]['feat'],feature(0)) for p in r._get_gallery())
    migrate(engine);assert len(r.list_people())==2
