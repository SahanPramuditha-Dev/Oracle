"""Download the pinned, checksum-verified YOLOv8n segmentation ONNX export."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

URL = 'https://huggingface.co/unileon-robotics/YOLO8-ONNX/resolve/373a78d20b7065044849fd21a5c4eae618231a50/yolov8n-seg.onnx'
SHA256 = 'f322e2b816501b9dfe88518f7742271f59719fcf46e7cbc42aff46c4f8eddcb5'
TARGET = Path(__file__).resolve().parents[1] / 'models/vision/yolov8n-seg.onnx'

def main():
    if TARGET.exists() and hashlib.sha256(TARGET.read_bytes()).hexdigest() == SHA256:
        print('Segmentation model verified')
        return
    with urlopen(URL, timeout=120) as response:
        payload = response.read()
    if hashlib.sha256(payload).hexdigest() != SHA256:
        raise RuntimeError('Model checksum mismatch')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = TARGET.with_suffix('.download')
    temporary.write_bytes(payload)
    temporary.replace(TARGET)
    print('Segmentation model installed and verified')

if __name__ == '__main__':
    main()
