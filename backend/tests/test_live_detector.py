import hashlib
import json
import pytest
from app.live_detector import load_profile

def profile(tmp_path):
    model = tmp_path/'candidate.onnx'
    model.write_bytes(b'fake-weights')
    config = {'version':1,'model':model.name,'classes':['person','pen'],
              'segmentation':True,'sha256':hashlib.sha256(model.read_bytes()).hexdigest()}
    path = tmp_path/'profile.json'
    path.write_text(json.dumps(config))
    return path, config

def test_profile_preserves_labels_and_segmentation(tmp_path):
    path, _ = profile(tmp_path)
    detector = load_profile(path)
    assert detector.class_names == ['person','pen']
    assert detector.supports_masks
    assert detector._session is None

@pytest.mark.parametrize('change', [
    {'classes':['pen','pen']}, {'classes':[]}, {'classes':[None]},
    {'sha256':'0'*64}, {'version':2}, {'model':'../escape.onnx'}])
def test_invalid_profiles_rejected(tmp_path, change):
    path, config = profile(tmp_path)
    path.write_text(json.dumps({**config, **change}))
    with pytest.raises(ValueError):
        load_profile(path)
