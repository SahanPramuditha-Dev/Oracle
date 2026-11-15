"""Build a prompted YOLOE ONNX candidate in an isolated Ultralytics environment.

Does not activate the candidate. Benchmark before installing its manifest.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import ssl

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', default='yoloe-11s-seg.pt')
    parser.add_argument('--vocabulary', type=Path, default=ROOT/'backend/app/live_object_vocabulary.json')
    parser.add_argument('--output', type=Path, default=ROOT/'models/vision/yoloe-candidate')
    parser.add_argument('--prompts', type=Path, default=ROOT/'backend/app/live_object_prompts.json')
    args = parser.parse_args()
    if os.name == 'nt' and not os.environ.get('REQUESTS_CA_BUNDLE'):
        # Requests otherwise uses certifi rather than the Windows trust store.
        trust = ROOT/'.setup/vision-bench/system-ca.pem'
        trust.parent.mkdir(parents=True, exist_ok=True)
        trust.write_text(''.join(ssl.DER_cert_to_PEM_cert(cert) for cert in
                                ssl.create_default_context().get_ca_certs(binary_form=True)), encoding='ascii')
        os.environ['REQUESTS_CA_BUNDLE'] = str(trust)
    from ultralytics import YOLOE
    names = json.loads(args.vocabulary.read_text(encoding='utf-8'))
    if not isinstance(names, list) or not names or len(set(names)) != len(names):
        parser.error('Vocabulary must be a nonempty list of distinct labels')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    os.chdir(output)
    overrides = json.loads(args.prompts.read_text(encoding='utf-8'))
    prompts = [overrides.get(name, name) for name in names]
    model = YOLOE(args.checkpoint)
    model.set_classes(names, model.get_text_pe(prompts))
    exported = Path(model.export(format='onnx', imgsz=640, opset=17, simplify=False,
                                 dynamic=False, nms=None, device='cpu'))
    destination = output/'model.onnx'
    if exported.resolve() != destination:
        shutil.copyfile(exported, destination)
    manifest = {'version': 1, 'model': 'model.onnx', 'classes': names,
                'checkpoint': args.checkpoint, 'prompts': prompts, 'segmentation': True,
                'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Candidate ready: {output / "manifest.json"}; not activated.')

if __name__ == '__main__':
    main()
