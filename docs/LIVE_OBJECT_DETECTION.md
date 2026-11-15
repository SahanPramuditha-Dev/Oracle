# Local live object detection

Live video uses `/api/v1/vision/detect` and returns boxes and labels. Image
descriptions are reserved for Capture & ask. Face recognition is independent.

## Build and compare a broader vocabulary

Build dependencies live in `.setup/vision-bench`, separate from `backend/.venv`.
The tested build uses CPU PyTorch 2.15.0, Ultralytics 8.4.202, and ONNX 1.23.2.
The runtime continues to use ONNX Runtime; it does not need PyTorch or CLIP.

`backend/app/live_object_vocabulary.json` contains the 50 proposed categories.
Run the following from the repository root, using the build environment:

```powershell
.setup/vision-bench/Scripts/python scripts/prepare_yoloe.py --checkpoint yoloe-26s-seg.pt --output models/vision/yoloe-26s
backend/.venv/Scripts/python scripts/benchmark_live_objects.py data/vision-benchmark/samples.json models/vision/yoloe-26s/manifest.json --output output/vision/yoloe-26s-benchmark.json
```

The preparation command exports a candidate and never activates it. Text prompts
are baked into the ONNX weights. Changing categories requires another export.
See the [official YOLOE export documentation](https://docs.ultralytics.com/models/yoloe/).

The benchmark's target hits are presence checks on a small local smoke-test set,
not general accuracy or bounding-box precision. Unidentified screenshot objects
are excluded from target scoring. Negative frames are scored separately. Keep a
held-out set of real camera clips before making general accuracy claims.

## Runtime selection and fallback

The smoke test kept YOLOv8m as the default. It found both scissors examples.
The best prompted YOLOE runs found one of the three confirmed targets. The
built-in-vocabulary YOLOE-26s run missed all three at a 0.25 confidence threshold
and labelled a blank white image as sky. The confirmed pen remains a missed
target. These results cover the local sample set only.

`backend/app/live_detector.py` reads `models/vision/live-detector.json` when
present. The profile specifies the model path relative to that directory,
SHA-256, class order, and segmentation support. Invalid or missing profiles
fall back to the existing COCO detector. The profile is validated before loading.

The capabilities endpoint reports the active model and its exact live categories.
Normal live requests skip mask encoding; foreground isolation can request masks
from the same segmentation-capable model. Object labels require repeated reads;
short movement prediction bridges updates without preserving missing objects
indefinitely. Collapsing camera controls does not stop detection.

## Custom objects

Use real images from varied distances, angles, lighting, and hand positions;
include background-only examples. Split by recording session before annotating,
so adjacent frames do not appear in both training and validation. The existing
`scripts/train_object_detector.py` checks class labels, boxes, and disjoint image
splits before training. `scripts/evaluate_objects.py` evaluates annotated boxes.
No custom training has been performed without a labelled dataset.
