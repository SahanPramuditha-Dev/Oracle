"""Validate disjoint YOLO dataset splits and optionally train/export a local detector."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import yaml

IMAGE_TYPES={'.jpg','.jpeg','.png','.bmp','.webp'}

def validate_dataset(dataset):
    config=yaml.safe_load(dataset.read_text(encoding='utf-8'))
    if not isinstance(config,dict):raise ValueError('Dataset YAML must be a mapping')
    root=(dataset.parent/config.get('path','.')).resolve()
    labels=config['names']
    if isinstance(labels,dict): labels=[labels[i] for i in range(len(labels))]
    if not isinstance(labels,list) or not labels or any(not isinstance(c,str) or not c.strip() for c in labels) or len(set(labels))!=len(labels):
        raise ValueError('Dataset names must be distinct nonempty class labels')
    fingerprints={};summary={}
    for split in ('train','val'):
        folder=(root/config[split]).resolve()
        if not folder.is_dir(): raise ValueError(f'{split} must name an image directory')
        images=[p for p in folder.rglob('*') if p.is_file() and p.suffix.lower() in IMAGE_TYPES]
        if not images: raise ValueError(f'{split} has no images')
        for image in images:
            parts=list(image.parts)
            if 'images' not in parts:raise ValueError('Use the standard images/train and labels/train directory layout')
            parts[len(parts)-1-parts[::-1].index('images')]='labels'
            annotation=Path(*parts).with_suffix('.txt')
            if not annotation.is_file():raise ValueError(f'Missing annotation for {image.name}; use an empty label file for a negative image')
            for line in annotation.read_text(encoding='utf-8').splitlines():
                if not line.strip():continue
                values=line.split()
                if len(values)!=5:raise ValueError('Detection labels require class_id x_center y_center width height')
                cid=int(values[0]);x,y,w,h=map(float,values[1:])
                if not (0<=cid<len(labels) and 0<=x<=1 and 0<=y<=1 and 0<w<=1 and 0<h<=1 and x-w/2>=-.00001 and y-h/2>=-.00001 and x+w/2<=1.00001 and y+h/2<=1.00001):
                    raise ValueError('Invalid class index or normalized detection box')
        fingerprints[split]={hashlib.sha256(p.read_bytes()).digest() for p in images}
        summary[split]=len(images)
    if fingerprints['train'] & fingerprints['val']:
        raise ValueError('The same image appears in training and validation; use separate captures')
    return labels,summary,root,config

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('dataset',type=Path);parser.add_argument('--train',action='store_true');parser.add_argument('--epochs',type=int,default=50);parser.add_argument('--device',default='cpu');parser.add_argument('--output',type=Path,default=Path('data/object-training'))
    args=parser.parse_args()
    if args.epochs<1:parser.error('Epochs must be positive')
    try: names,summary,root,config=validate_dataset(args.dataset.resolve())
    except (ValueError,TypeError,KeyError,OSError) as err:parser.error(str(err))
    print(json.dumps({'classes':names,'image_counts':summary}))
    if args.train:
        try:from ultralytics import YOLO
        except ImportError:parser.error('Install Ultralytics and ONNX in a separate training environment first')
        output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
        normalized=output/'dataset.yaml';normalized.write_text(yaml.safe_dump({**config,'path':str(root),'names':names}),encoding='utf-8')
        model=YOLO('yolov8n.pt');model.train(data=str(normalized),epochs=args.epochs,imgsz=640,device=args.device,project=str(output),name='training')
        best=YOLO(str(model.trainer.best));export=Path(best.export(format='onnx',imgsz=640,nms=False,device=args.device))
        shutil.copyfile(export,output/'custom-objects.onnx')
        (output/'custom-objects.labels.json').write_text(json.dumps(names,indent=2),encoding='utf-8')
        print('Export saved for evaluation. The active camera model has not been replaced.')
