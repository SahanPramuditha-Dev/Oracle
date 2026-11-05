"""Evaluate local face identification on a held-out, explicitly labeled manifest.

Usage: backend/.venv/Scripts/python.exe scripts/evaluate_people.py manifest.json
Manifest: {"enrollment":[{"id":"a","images":["a1.jpg"]}],
           "probes":[{"image":"a2.jpg","expected_id":"a"},{"image":"unknown.jpg","expected_id":null}]}
Paths are relative to the manifest. Exact image reuse across enrollment/probes is rejected.
Temporary biometric storage is removed on exit; output contains aggregate metrics only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.database import database_engine,migrate
from app.people import PersonRecognizer,DEFAULT_SFACE_THRESHOLD

def evaluate(manifest_path,threshold=DEFAULT_SFACE_THRESHOLD):
    manifest_path=Path(manifest_path).resolve()
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if not manifest.get('enrollment') or not manifest.get('probes'):
        raise ValueError('Include enrollment identities and held-out probes')
    payloads={}
    def read(path):
        resolved=(manifest_path.parent/path).resolve()
        if resolved not in payloads: payloads[resolved]=resolved.read_bytes()
        return payloads[resolved]
    labels=[p['id'] for p in manifest['enrollment']]
    if len(set(labels))!=len(labels): raise ValueError('Enrollment labels must be unique')
    enrollment_hashes={hashlib.sha256(read(image)).digest() for p in manifest['enrollment'] for image in p['images']}
    for probe in manifest['probes']:
        if probe['expected_id'] is not None and probe['expected_id'] not in labels:
            raise ValueError('Probe expected_id must be enrolled, or null for an unknown person')
        if hashlib.sha256(read(probe['image'])).digest() in enrollment_hashes:
            raise ValueError('Enrollment and evaluation images must be distinct captures')
    counts={'known':0,'unknown':0,'correct_identifications':0,'false_identifications':0,'known_rejections':0,'unknown_false_accepts':0,'unknown_rejections':0,'quality_failures':0,'ambiguous':0,'no_face':0,'multiple_faces':0}
    latency=[]
    with tempfile.TemporaryDirectory(prefix='oracle-face-eval-') as folder:
        engine=database_engine(Path(folder)/'evaluation.sqlite3');migrate(engine)
        recognizer=PersonRecognizer(engine);ids={}
        try:
            for person in manifest['enrollment']:
                if not person['images']: raise ValueError('Each identity needs an enrollment image')
                for image in person['images']:
                    result=recognizer.enroll(person['id'],'',read(image),ids.get(person['id']),person['id'] in ids)
                    ids[person['id']]=result['id']
            for probe in manifest['probes']:
                known=probe['expected_id'] is not None;counts['known' if known else 'unknown']+=1
                result=recognizer.identify(read(probe['image']),threshold)
                latency.append(result['latency_ms']);faces=result['identified']
                if not faces: counts['no_face']+=1
                if len(faces)>1: counts['multiple_faces']+=1
                face=faces[0] if len(faces)==1 else None
                if face and face['recognition_state']=='poor_quality': counts['quality_failures']+=1
                if face and face['recognition_state']=='uncertain': counts['ambiguous']+=1
                accepted=face is not None and face['matched']
                if known:
                    if accepted and face['id']==ids[probe['expected_id']]: counts['correct_identifications']+=1
                    elif accepted: counts['false_identifications']+=1
                    else: counts['known_rejections']+=1
                elif accepted: counts['unknown_false_accepts']+=1
                else: counts['unknown_rejections']+=1
        finally: engine.dispose()
    return {'threshold':threshold,'counts':counts,
        'unknown_false_accept_rate':counts['unknown_false_accepts']/counts['unknown'] if counts['unknown'] else None,
        'known_rejection_rate':counts['known_rejections']/counts['known'] if counts['known'] else None,
        'known_wrong_identity_rate':counts['false_identifications']/counts['known'] if counts['known'] else None,
        'latency_ms':{'median':round(float(np.median(latency)),2),'p95':round(float(np.percentile(latency,95)),2)},
        'scope':'Single-face still-image identification. Not verification calibration, liveness, video tracking, or an access-security assessment.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('manifest');parser.add_argument('--threshold',type=float,default=DEFAULT_SFACE_THRESHOLD)
    args=parser.parse_args()
    if not DEFAULT_SFACE_THRESHOLD<=args.threshold<=1: parser.error('Threshold must be between 0.363 and 1')
    print(json.dumps(evaluate(args.manifest,args.threshold),indent=2))
