import numpy as np
from PIL import Image
from app.everyday_objects import EverydayObjectDetector,crop_regions,merge_detections
from app.detector import ObjectDetector

def test_crop_regions_bounded():
    for w,h in [(1,1),(640,360),(1920,1080)]:
        regions=crop_regions(w,h,[{'box':[-100,0,200,400]}])
        assert regions[0]==(0,0,w,h) and len(regions)<=6
        assert all(0<=x<x2<=w and 0<=y<y2<=h for x,y,x2,y2 in regions)

def test_cross_crop_duplicates_suppressed_per_class():
    detections=[{'class':'pen','box':[10,10,100,20],'confidence':.8},
                {'class':'pen','box':[11,10,100,20],'confidence':.7},
                {'class':'keys','box':[10,10,100,20],'confidence':.9}]
    assert [d['class'] for d in merge_detections(detections)]==['keys','pen']

def test_custom_class_layout_and_no_second_sigmoid():
    class Session:
        def get_inputs(self): return [type('Input',(),{'name':'images'})()]
        def run(self,names,feeds):
            assert 'txt_feats' in feeds
            out=np.zeros((1,6,2),np.float32)
            out[0,:4,0]=[320,320,100,50];out[0,4,0]=.8
            out[0,:4,1]=[100,100,20,20];out[0,5,1]=.02
            return [out]
    detector=ObjectDetector(class_names=['pen','keys']);detector._session=Session()
    detector.extra_inputs={'txt_feats':np.zeros((1,2,512),np.float32)}
    assert [d['class'] for d in detector.detect(Image.new('RGB',(640,640)))['detections']]==['pen']

def test_actual_world_blank_frame_has_no_false_detections():
    detector=EverydayObjectDetector();assert detector.available
    result=detector.detect(Image.new('RGB',(640,480),'white'))
    assert result['detections']==[] and result['regions_analyzed']==4
