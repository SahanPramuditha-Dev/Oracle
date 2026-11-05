"""Compare the detector with and without close-ups on held-out annotated images."""
import argparse
import json
from pathlib import Path
import sys
import time
from collections import defaultdict
import numpy as np
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.everyday_objects import EverydayObjectDetector


def iou(a,b):
    x,y,w,h=a; xx,yy,ww,hh=b
    intersection=max(0,min(x+w,xx+ww)-max(x,xx))*max(0,min(y+h,yy+hh)-max(y,yy))
    return intersection/max(1,w*h+ww*hh-intersection)


def score_image(expected,predicted,overlap=.5):
    counts=defaultdict(lambda: {'tp':0,'fp':0,'fn':0})
    remaining=set(range(len(expected)))
    for d in sorted(predicted,key=lambda d:d['confidence'],reverse=True):
        candidates=[(iou(d['box'],expected[i]['box']),i) for i in remaining if d['class']==expected[i]['class']]
        score,index=max(candidates,default=(0,-1))
        if score>=overlap:
            remaining.remove(index);counts[d['class']]['tp']+=1
        else:counts[d['class']]['fp']+=1
    for index in remaining:counts[expected[index]['class']]['fn']+=1
    return counts


def evaluate(path,confidence=.25,overlap=.5,model=None,labels=None):
    path=Path(path).resolve();samples=json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(samples,list) or not samples:raise ValueError('Provide a nonempty list of annotated test images')
    engine=EverydayObjectDetector(model_path=model,vocabulary_path=labels) if model else EverydayObjectDetector()
    engine.detect(Image.new('RGB',(640,480)),closeups=False)  # Exclude model startup from latency.
    reports={}
    for closeups in (False,True):
        counts=defaultdict(lambda:{'tp':0,'fp':0,'fn':0});latency=[];empty_false_alarms=0
        for sample in samples:
            with Image.open(path.parent/sample['image']) as raw: image=ImageOps.exif_transpose(raw).convert('RGB')
            truth=sample['objects']
            for obj in truth:
                x,y,w,h=obj['box']
                if not (0<=x<x+w<=image.width and 0<=y<y+h<=image.height):raise ValueError('Ground truth box lies outside its image')
            started=time.perf_counter()
            result=engine.detect(image,confidence=confidence,closeups=closeups)
            latency.append((time.perf_counter()-started)*1000)
            detected=[d for d in result['detections'] if not d['ambiguous']]
            empty_false_alarms+=not truth and bool(detected)
            for label,stats in score_image(truth,detected,overlap).items():
                for key,value in stats.items():counts[label][key]+=value
        totals={key:sum(c[key] for c in counts.values()) for key in ('tp','fp','fn')}
        tp,fp,fn=totals.values()
        reports['closeups' if closeups else 'whole_frame']={'counts':totals,'per_class':dict(counts),
            'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,
            'empty_frame_false_alarms':empty_false_alarms,'latency_ms':{'median':round(float(np.median(latency)),1),'p95':round(float(np.percentile(latency,95)),1)}}
    return {'images':len(samples),'confidence':confidence,'iou':overlap,'reports':reports,
        'scope':'Raw detector boxes. Excludes local vision cross-checks, temporal confirmation and camera latency.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('manifest');parser.add_argument('--confidence',type=float,default=.25);parser.add_argument('--iou',type=float,default=.5)
    parser.add_argument('--model',type=Path);parser.add_argument('--labels',type=Path)
    args=parser.parse_args()
    if bool(args.model)!=bool(args.labels):parser.error('Provide both --model and --labels for a custom export')
    if not 0<args.confidence<=1 or not 0<args.iou<=1:parser.error('Thresholds must be in (0, 1]')
    print(json.dumps(evaluate(args.manifest,args.confidence,args.iou,args.model,args.labels),indent=2))
