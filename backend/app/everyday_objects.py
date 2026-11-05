"""Local text-conditioned everyday-object detection with bounded close-up passes."""
import json
import threading
import time
from pathlib import Path
import cv2
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from .detector import ObjectDetector, MODEL_PATH

VOCABULARY=Path(__file__).with_name('object_vocabulary.json')

def crop_regions(width,height,people=()):
    regions=[(0,0,width,height)]
    # Center and lower left/right views retain detail lost by full-frame resizing.
    regions.extend([(width//4,height//4,3*width//4,3*height//4),
                    (0,height//3,3*width//5,height),
                    (2*width//5,height//3,width,height)])
    for person in people:
        x,y,w,h=person['box']
        regions.append((max(0,int(x-w*.15)),max(0,int(y+h*.35)),min(width,int(x+w*1.15)),min(height,int(y+h))))
    unique=[]
    for r in regions:
        if r[2]>r[0] and r[3]>r[1] and r not in unique: unique.append(r)
    return unique[:6]

def merge_detections(detections,threshold=.4):
    kept=[]
    for label in sorted({d['class'] for d in detections}):
        group=[d for d in detections if d['class']==label]
        indices=cv2.dnn.NMSBoxes([d['box'] for d in group],[d['confidence'] for d in group],0.,threshold)
        kept.extend(group[int(i)] for i in np.asarray(indices).reshape(-1))
    kept.sort(key=lambda d:d['confidence'],reverse=True)
    return kept[:20]

class EverydayObjectDetector:
    def __init__(self,model_dir=None,vocabulary_path=VOCABULARY,model_path=None):
        self.root=Path(model_dir) if model_dir else MODEL_PATH.parent
        self.classes=json.loads(Path(vocabulary_path).read_text(encoding='utf-8'))
        if not isinstance(self.classes,list) or not 1<=len(self.classes)<=80 or any(not isinstance(c,str) or not c.strip() or len(c)>80 for c in self.classes) or len(set(self.classes))!=len(self.classes):
            raise ValueError('Object vocabulary must contain 1–80 distinct nonempty labels')
        # This export already applies sigmoid. Applying it again creates false
        # detections around 0.5 even on blank images, despite the model card text.
        self.custom_model=Path(model_path) if model_path else None
        self.detector=ObjectDetector(self.custom_model or self.root/'yolov8s-worldv2.onnx',class_names=self.classes)
        self._lock=threading.Lock()
        self._ready=self.custom_model is not None
    @property
    def available(self):
        if self.custom_model:return self.custom_model.is_file()
        return all((self.root/n).is_file() for n in ['yolov8s-worldv2.onnx','clip-text.onnx','clip-tokenizer.json'])
    def _prepare(self):
        if self._ready:return
        if not self.available:raise FileNotFoundError('Run scripts/prepare_object_models.ps1 to install local object models')
        tokenizer=Tokenizer.from_file(str(self.root/'clip-tokenizer.json'))
        tokenizer.enable_truncation(max_length=77)
        tokenizer.enable_padding(length=77,pad_id=49407,pad_token='<|endoftext|>')
        encoded=tokenizer.encode_batch(self.classes)
        ids=np.array([e.ids for e in encoded],dtype=np.int64)
        encoder=ort.InferenceSession(str(self.root/'clip-text.onnx'),providers=['CPUExecutionProvider'])
        embeddings=encoder.run(['text_embeds'],{'input_ids':ids})[0]
        embeddings=embeddings/np.maximum(np.linalg.norm(embeddings,axis=-1,keepdims=True),1e-12)
        self.detector.extra_inputs={'txt_feats':embeddings[None].astype(np.float32)}
        self._ready=True
        # The text encoder can be released: only the small class embeddings are
        # needed for image inference. Changing labels requires a backend restart.
    def detect(self,image,people=(),confidence=.25,closeups=True):
        started=time.perf_counter()
        with self._lock:
            self._prepare()
            regions=crop_regions(*image.size,people) if closeups else [(0,0,*image.size)]
            detections=[]
            for region in regions:
                result=self.detector.detect(image.crop(region),confidence)
                for d in result['detections']:
                    x,y,w,h=d['box']
                    detections.append({**d,'box':[x+region[0],y+region[1],w,h],'source':'open_vocabulary'})
            detections=merge_detections(detections)
            # Reject competing class labels on substantially the same object.
            for d in detections:
                x,y,w,h=d['box'];d['ambiguous']=False
                for other in detections:
                    if other['class']==d['class']:continue
                    a,b,c,e=other['box']
                    overlap=max(0,min(x+w,a+c)-max(x,a))*max(0,min(y+h,b+e)-max(y,b))
                    if overlap/max(1,w*h+c*e-overlap)>.5 and abs(d['confidence']-other['confidence'])<.05:
                        d['ambiguous']=True
            return {'detections':detections,'classes':self.classes,'regions_analyzed':len(regions),
                'image_width':image.width,'image_height':image.height,'latency_ms':round((time.perf_counter()-started)*1000,2),
                'model':self.detector.model_path.stem,'processing':'local'}
