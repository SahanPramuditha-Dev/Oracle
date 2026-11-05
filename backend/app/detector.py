"""Fast, local person and object detection using YOLOv8-nano and ONNX Runtime."""
import base64
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image

MODEL_PATH = Path(__file__).resolve().parents[2] / 'models/vision/yolov8n.onnx'

COCO_CLASSES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
    'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
    'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
    'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
    'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
    'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
    'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
    'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
]


class ObjectDetector:
    def __init__(self, model_path: Path | str | None = None, class_names: list[str] | None = None, logits: bool = False):
        self.model_path = Path(model_path) if model_path else MODEL_PATH
        self.class_names = list(class_names) if class_names is not None else COCO_CLASSES
        self.logits = logits
        self.extra_inputs = {}
        self._session = None
        self._lock = threading.Lock()

    @property
    def session(self) -> ort.InferenceSession:
        if self._session is None:
            with self._lock:
                if self._session is None:
                    if not self.model_path.exists():
                        raise FileNotFoundError(f'Detector model not found at {self.model_path}')
                    # Prefer DirectML / CUDA if available, fallback to CPU
                    providers = ['CPUExecutionProvider']
                    available = ort.get_available_providers()
                    if 'CUDAExecutionProvider' in available:
                        providers.insert(0, 'CUDAExecutionProvider')
                    elif 'DmlExecutionProvider' in available:
                        providers.insert(0, 'DmlExecutionProvider')
                    self._session = ort.InferenceSession(str(self.model_path), providers=providers)
        return self._session

    def detect(self, image: Image.Image, conf_threshold: float = 0.35, nms_threshold: float = 0.45) -> dict[str, Any]:
        """Decode standard COCO YOLOv8 detection or segmentation ONNX outputs."""
        started = time.perf_counter()
        orig_w, orig_h = image.size
        size = 640
        ratio = min(size / orig_w, size / orig_h)
        rw, rh = max(1, round(orig_w * ratio)), max(1, round(orig_h * ratio))
        left, top = (size - rw) // 2, (size - rh) // 2
        padded = np.full((size, size, 3), 114, dtype=np.uint8)
        padded[top:top + rh, left:left + rw] = cv2.resize(np.array(image.convert('RGB')), (rw, rh))
        blob = cv2.dnn.blobFromImage(padded, 1 / 255.0, (size, size), swapRB=False)
        outputs = self.session.run(None, {self.session.get_inputs()[0].name: blob, **self.extra_inputs})
        predictions = outputs[0][0].T
        proto = outputs[1][0] if len(outputs) > 1 else None
        nc = len(self.class_names)
        expected = 4 + nc + (proto.shape[0] if proto is not None else 0)
        if predictions.ndim != 2 or predictions.shape[1] != expected:
            raise ValueError('Unsupported YOLO output layout; expected a standard COCO export without embedded NMS')
        scores = predictions[:, 4:4+nc]
        if self.logits:
            scores = 1 / (1 + np.exp(-np.clip(scores, -80, 80)))
        ids = scores.argmax(axis=1)
        confidence = scores.max(axis=1)
        candidates = np.flatnonzero((confidence >= conf_threshold) & np.isfinite(predictions).all(axis=1))
        boxes, rows = [], []
        for row in candidates:
            xc, yc, w, h = predictions[row, :4]
            x1, x2 = np.clip([(xc - w / 2 - left) * orig_w / rw, (xc + w / 2 - left) * orig_w / rw], 0, orig_w)
            y1, y2 = np.clip([(yc - h / 2 - top) * orig_h / rh, (yc + h / 2 - top) * orig_h / rh], 0, orig_h)
            x1, y1, x2, y2 = round(float(x1)), round(float(y1)), round(float(x2)), round(float(y2))
            if x2 > x1 and y2 > y1:
                boxes.append([x1, y1, x2 - x1, y2 - y1])
                rows.append(row)
        kept = []
        for cid in sorted(set(int(ids[r]) for r in rows)):
            group = [i for i, r in enumerate(rows) if ids[r] == cid]
            selected = cv2.dnn.NMSBoxes([boxes[i] for i in group], [float(confidence[rows[i]]) for i in group], conf_threshold, nms_threshold)
            kept.extend(group[int(i)] for i in np.asarray(selected).reshape(-1))
        kept.sort(key=lambda i: float(confidence[rows[i]]), reverse=True)
        detections = []
        # Bound mask encoding cost and response size in crowded scenes.
        for i in kept[:30]:
            row = rows[i]
            box = boxes[i]
            item = {'class': self.class_names[int(ids[row])], 'confidence': round(float(confidence[row]), 3), 'box': box}
            if proto is not None:
                logits = predictions[row, 4+nc:] @ proto.reshape(proto.shape[0], -1)
                mask = (logits.reshape(proto.shape[1:]) > 0).astype(np.float32)
                mask = cv2.resize(mask, (size, size))[top:top + rh, left:left + rw]
                mask = cv2.resize(mask, (orig_w, orig_h))
                x, y, w, h = box
                crop = (mask[y:y+h, x:x+w] * 255).astype(np.uint8)
                crop = cv2.GaussianBlur(crop, (3, 3), 0.6)
                rgba = np.zeros((h, w, 4), dtype=np.uint8)
                rgba[:, :, :3] = 255
                rgba[:, :, 3] = crop
                ok, encoded = cv2.imencode('.png', rgba)
                if ok:
                    item['mask'] = 'data:image/png;base64,' + base64.b64encode(encoded).decode('ascii')
            detections.append(item)
        count = sum(d['class'] == 'person' for d in detections)
        return {'detections': detections, 'person_count': count, 'has_person': count > 0,
                'classes': sorted({d['class'] for d in detections}), 'segmentation': proto is not None,
                'image_width': orig_w, 'image_height': orig_h,
                'latency_ms': round((time.perf_counter() - started) * 1000, 2)}
