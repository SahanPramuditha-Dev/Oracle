"""Deterministic geometry and segmentation regression tests, independent of weights."""
import base64
from types import SimpleNamespace
import cv2
import numpy as np
from PIL import Image
from app.detector import ObjectDetector

class Session:
    def __init__(self, predictions, proto=None):
        self.outputs = [predictions.T[None].astype(np.float32)]
        if proto is not None:
            self.outputs.append(proto[None].astype(np.float32))
    def get_inputs(self):
        return [SimpleNamespace(name='images')]
    def run(self, names, inputs):
        self.blob = inputs['images']
        return self.outputs

def detector(rows, proto=None):
    d = ObjectDetector()
    d._session = Session(np.array(rows), proto)
    return d

def row(box, cid=0, confidence=.9, segment=False):
    r = np.zeros(116 if segment else 84)
    r[:4] = box; r[4+cid] = confidence
    if segment:
        r[84] = 1
    return r

def test_letterbox_landscape_and_same_class_nms():
    d = detector([row([320,320,320,160]), row([320,320,320,160], confidence=.8)])
    result = d.detect(Image.new('RGB', (1280,640)))
    assert result['detections'][0]['box'] == [320,160,640,320]
    assert len(result['detections']) == 1
    assert np.allclose(d.session.blob[0,:,0,0], 114/255)

def test_different_classes_do_not_suppress_and_clip_bounds():
    d = detector([row([10,10,100,100]), row([10,10,100,100], cid=67)])
    result = d.detect(Image.new('RGB',(640,640)))
    assert len(result['detections']) == 2
    assert all(x['box'] == [0,0,60,60] for x in result['detections'])

def test_portrait_padding_and_invalid_boxes_removed():
    d = detector([row([320,320,160,320]), row([0,0,1,1])])
    result = d.detect(Image.new('RGB',(640,1280)))
    assert [x['box'] for x in result['detections']] == [[160,320,320,640]]

def test_foreground_mask_is_cropped_and_background_transparent():
    proto = np.full((32,160,160), -1., dtype=np.float32)
    proto[0,:,80:] = 1.
    d = detector([row([320,320,320,160],segment=True)], proto)
    result = d.detect(Image.new('RGB',(1280,640)))
    item = result['detections'][0]
    image = cv2.imdecode(np.frombuffer(base64.b64decode(item['mask'].split(',')[1]),np.uint8),cv2.IMREAD_UNCHANGED)
    assert result['segmentation'] is True
    assert image.shape == (320,640,4)
    assert image[160,20,3] == 0
    assert image[160,-20,3] == 255

def test_empty_frame():
    result = detector([row([320,320,10,10],confidence=.1)]).detect(Image.new('RGB',(640,480)))
    assert result['detections'] == []
    assert result['person_count'] == 0
