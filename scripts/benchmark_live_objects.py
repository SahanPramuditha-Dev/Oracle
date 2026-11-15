"""Compare live ONNX detectors on a local manifest; never uploads images.

Each sample supplies image, optional crop [left,top,right,bottom], and targets
(class names). Empty targets denote a negative frame. This is a smoke test,
not a dataset-wide accuracy claim or a bounding-box precision evaluation.
"""
import argparse
import json
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from PIL import Image
from app.detector import ObjectDetector

def benchmark(engine, samples, base, threshold):
    engine.detect(Image.new('RGB', (640, 480)), threshold, include_masks=False)
    rows = []
    for sample in samples:
        with Image.open(base/sample['image']) as source:
            image = source.convert('RGB')
        if 'crop' in sample:
            image = image.crop(sample['crop'])
        result = engine.detect(image, threshold, include_masks=False)
        labels = set(result['classes'])
        rows.append({'sample': sample.get('name', sample['image']),
                     'targets': sample['targets'],
                     'negative':sample.get('negative', not sample['targets']),
                     'found_targets': sorted(labels.intersection(sample['targets'])),
                     'detections': result['detections'], 'latency_ms': result['latency_ms']})
    return {'samples': rows, 'target_hits': sum(len(r['found_targets']) for r in rows),
            'target_count': sum(len(r['targets']) for r in rows),
            'negative_false_detections': sum(len(r['detections']) for r in rows if r['negative']),
            'median_ms': statistics.median(r['latency_ms'] for r in rows)}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('samples', type=Path)
    p.add_argument('candidate', type=Path, help='Candidate manifest.json')
    p.add_argument('--threshold', type=float, default=.35)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    manifest = json.loads(args.candidate.read_text(encoding='utf-8'))
    samples = json.loads(args.samples.read_text(encoding='utf-8'))
    candidate = ObjectDetector(args.candidate.parent/manifest['model'], manifest['classes'])
    baseline = ObjectDetector(ROOT/'models/vision/yolov8m.onnx')
    report = {name: benchmark(engine, samples, args.samples.parent, args.threshold)
              for name, engine in [('baseline', baseline), ('candidate', candidate)]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({name: {k:v for k,v in r.items() if k != 'samples'} for name,r in report.items()}, indent=2))

if __name__ == '__main__':
    main()
