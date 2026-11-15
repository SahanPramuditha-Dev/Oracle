"""Load a locally benchmarked detector profile, with a safe COCO fallback."""
import hashlib
import json
import logging
from pathlib import Path
from .detector import ObjectDetector, MODEL_PATH

logger = logging.getLogger(__name__)

def load_profile(path: Path) -> ObjectDetector:
    profile = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(profile, dict):
        raise ValueError('Live detector profile must be an object')
    names = profile.get('classes')
    if (profile.get('version') != 1 or not isinstance(names, list) or not 1 <= len(names) <= 200
            or any(not isinstance(n, str) or not n.strip() or len(n) > 80 for n in names)
            or len(set(names)) != len(names)):
        raise ValueError('Invalid live detector vocabulary/profile')
    root = path.parent.resolve()
    if not isinstance(profile.get('model'), str):
        raise ValueError('Live detector model must be a relative path')
    model = (root/profile['model']).resolve()
    if not model.is_relative_to(root):
        raise ValueError('Live detector model must stay inside the profile directory')
    expected = profile.get('sha256', '')
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError('Live detector model checksum mismatch')
    with model.open('rb') as model_file:
        if hashlib.file_digest(model_file, 'sha256').hexdigest() != expected:
            raise ValueError('Live detector model checksum mismatch')
    detector = ObjectDetector(model, class_names=names)
    detector.supports_masks = profile.get('segmentation') is True
    return detector

def create_live_detector() -> ObjectDetector:
    path = MODEL_PATH.parent/'live-detector.json'
    if path.is_file():
        try:
            return load_profile(path)
        except (ValueError, KeyError, TypeError, OSError):
            logger.exception('Live detector profile could not be loaded; using COCO fallback')
    return ObjectDetector()
