from pathlib import Path
import json
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
import evaluate_people

class FakeRecognizer:
    def __init__(self,engine): pass
    def enroll(self,name,notes,payload,person_id=None,append_sample=False): return {'id':name}
    def identify(self,payload,threshold):
        faces={'correct':[{'matched':True,'id':'a','recognition_state':'recognized'}],
            'wrong':[{'matched':True,'id':'b','recognition_state':'recognized'}],
            'reject':[{'matched':False,'id':None,'recognition_state':'uncertain'}],
            'unknown_accept':[{'matched':True,'id':'a','recognition_state':'recognized'}],
            'empty':[]}[payload.decode()]
        return {'identified':faces,'latency_ms':10}

def manifest(tmp_path,probes):
    for name in ['enroll_a','enroll_b',*probes]: (tmp_path/name).write_text(name)
    m={'enrollment':[{'id':'a','images':['enroll_a']},{'id':'b','images':['enroll_b']}],
       'probes':[{'image':name,'expected_id':'a' if name in ['correct','wrong','reject'] else None} for name in probes]}
    p=tmp_path/'manifest.json';p.write_text(json.dumps(m));return p

def test_evaluation_reports_wrong_identity_separately_from_rejection(tmp_path,monkeypatch):
    monkeypatch.setattr(evaluate_people,'PersonRecognizer',FakeRecognizer)
    report=evaluate_people.evaluate(manifest(tmp_path,['correct','wrong','reject','unknown_accept','empty']))
    assert report['known_wrong_identity_rate']==pytest.approx(1/3)
    assert report['known_rejection_rate']==pytest.approx(1/3)
    assert report['unknown_false_accept_rate']==.5
    assert report['counts']['no_face']==1 and report['counts']['ambiguous']==1
    assert report['latency_ms']['p95']==10

def test_evaluation_rejects_enrollment_probe_reuse(tmp_path):
    p=manifest(tmp_path,['enroll_a'])
    with pytest.raises(ValueError,match='distinct captures'): evaluate_people.evaluate(p)
