# Object detection and foreground separation

The camera now offers **Foreground → All people** or **Selected object**. Choose an object by its tracked class and ID. A cropped instance mask preserves the subject while dimming the background. Missing subjects restore the unobscured preview. Frames are processed locally; no camera frames are sent to model-hosting services.

## Implementation

- Aspect-preserving 640×640 letterboxing with exact reversal of resize and padding.
- Class-aware suppression; boxes clipped at both corners and empty boxes discarded.
- `POST /api/v1/vision/detect?segment=true` uses YOLOv8n-seg ONNX. Default detection remains compatible. Responses include image dimensions, a segmentation flag, and per-object cropped white RGBA PNG masks as data URLs. Masks use original-image box coordinates, with light edge feathering.
- Browser-local same-class IoU matching assigns stable IDs between consecutive observations. Box-only overlays are smoothed; masks and their boxes remain aligned to the same observation. Track IDs reset on camera restart, detection failure, or subject loss. They are not identity recognition.
- All detected categories, including people, are available for selection. Responses are capped at 30 objects to bound mask encoding costs.
- The viewport follows the source aspect ratio and mirror state. Preview colors are preserved.

## Model setup

Run `backend/.venv/Scripts/python.exe scripts/prepare_vision_models.py` from the repository root. The script downloads a pinned ONNX export and validates SHA-256 before installing it. Runtime needs only the existing ONNX Runtime, OpenCV and NumPy dependencies.

Source: https://huggingface.co/unileon-robotics/YOLO8-ONNX/blob/373a78d20b7065044849fd21a5c4eae618231a50/yolov8n-seg.onnx
SHA-256: f322e2b816501b9dfe88518f7742271f59719fcf46e7cbc42aff46c4f8eddcb5
See the upstream Ultralytics model licensing terms before redistribution.

## Validation and limits

Deterministic tests cover landscape/portrait mapping, overlapping classes, duplicate suppression, clipping, empty frames and mask alpha alignment. Endpoint checks exercise the actual local model. A public Ultralytics bus image smoke test produced five detections including three people, with masks, in roughly 209 ms including session initialization on this machine; this is not a real-time performance guarantee or accuracy benchmark.

The camera currently samples every 1.4 seconds and may skip low-motion frames for up to four seconds. It does not provide video-rate tracking or optical-flow mask propagation. Fast motion, occlusion and crossing same-class objects can lose or switch tracks; reselect a lost subject. Edge feathering is not hair/transparent-object matting. Masks are not temporally averaged because stale masks can leave motion trails. Foreground separation dims the background; snapshots continue to capture the original image for visual questions. Identifying personal objects such as “my mug” remains a separate reference-gallery feature.

For physical-camera acceptance, evaluate dim lighting, small objects, overlap, camera rotation, fast movement, subject exit/re-entry and hair edges. Measure detection precision/recall, mask IoU/boundary quality, ID switches and end-to-end latency on representative clips before claiming quality improvements.

## Held objects beyond the detector categories

The fixed COCO detector has no pen category. Camera-held object recognition now supplements it with the configured local vision model at `POST /api/v1/vision/objects/identify`. The model describes the presented object independently of bounding-box categories. Results are explicitly labeled **Local vision estimate** and do not supply verified labels, probabilities or object masks.

The camera checks automatically by default, with one request at a time and an eight-second pause after each response. **Auto identify** can be disabled while keeping the manual **Identify object** button. **Object view → Center close-up** crops the center half of the frame in each dimension for small objects; hold the item in the middle of the view. Whole-frame capture remains the default. Descriptions include the capture time, clear on the next request, and expire twenty seconds after display. Closing the camera, changing the view or opening face enrollment cancels the pending client request and clears the displayed result.

The server allows only one held-object analysis at a time per app process, requires local authorization, applies image upload limits and uses the existing local Ollama provider without a cloud fallback. The normal face/object overlay loop remains independent. Recognition depends on object visibility and model quality; no real-time detection guarantee is made for arbitrary classes.

Recognized person names replace generic person labels in foreground subject options. Main camera object overlays exclude the person class; the person outline and face name remain a single subject. Reload an already-open camera page after deployment to load the updated interface.
## Open-vocabulary object detector

The camera now supplements the fast COCO detector with YOLOv8s-World v2 and local CLIP text embeddings. Its editable vocabulary is in `backend/app/object_vocabulary.json`; changing it requires restarting the backend. No camera data is sent to the model host. Setup downloads are pinned and checked by `scripts/prepare_object_models.ps1`. Source model exports: [YOLO-World ONNX](https://huggingface.co/Instemic/yolo-world-onnx/tree/7e1d02c9467c32b141df81890737490764776785) and [CLIP text ONNX](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/6b7c523703ae26e39be4b03774966f8571c7f523). Check upstream model licenses before redistribution.

The detector analyzes the full frame, center, lower overlapping regions and up to two lower-body regions as a hand-area heuristic. It maps boxes back into the submitted image and suppresses same-class duplicates. It does not detect hand landmarks. The selected manual center crop is supported. The existing fast camera face/object and segmentation paths stay independent.

**Accuracy guard:** raw open-vocabulary predictions can be wrong even at high scores. In testing, the small and large World models both mislabeled a public blue pen as scissors on one photo. Oracle therefore checks candidate labels against its independent local vision description when available. Disagreeing boxes are withheld; the description remains an estimate. Agreeing labels must also recur in two spatially overlapping observations before being shown as confirmed across frames. This is a stability check, not proof of correctness. With no local vision model configured, the API returns raw detector estimates.

### Evaluation

Prepare a JSON list of separate test images and original-image pixel boxes. Include empty scenes, similar objects, different lighting and distances, and a different recording session from training.

```json
[{"image":"test-pen.jpg","objects":[{"class":"pen","box":[120,85,180,40]}]},
 {"image":"empty.jpg","objects":[]}]
```

```powershell
.\backend\.venv\Scripts\python.exe scripts\evaluate_objects.py path\to\manifest.json
```

The evaluator compares whole-frame and close-up precision, recall, false detections and warmed model latency. It measures raw detector boxes, independently of vision descriptions or temporal confirmation. A few public photographs are smoke tests, not an accuracy benchmark for a real camera.

### Train on personal objects

Use a YOLO detection dataset with separate `train` and `val` image directories and matching YOLO label files. Set its class names in the dataset YAML. The trainer checks for exact image reuse across splits; use independent recording sessions to avoid near-duplicate leakage. Without `--train` it validates the dataset layout only.

```powershell
.\backend\.venv\Scripts\python.exe scripts\train_object_detector.py path\to\dataset.yaml
```

In a separate training environment with Ultralytics and ONNX installed, invoke the same script with `--train`. It exports an ONNX model and class list under `data/object-training`. Compare it on a held-out manifest before promoting it:

```powershell
.\backend\.venv\Scripts\python.exe scripts\evaluate_objects.py path\to\manifest.json --model data\object-training\custom-objects.onnx --labels data\object-training\custom-objects.labels.json
```

The active camera model is never replaced automatically. No personal-object model has been trained; that requires labeled camera examples.


Validation note: live local inference identified two public pen photos as pens after cross-checking. On the diagonal photo, the conflicting raw scissors detection was rejected and only the vision description was shown. On the horizontal photo, a pen detection was corroborated; competing object labels were discarded. These examples do not establish camera accuracy. Test images: [Blue ink pen, Butterflylunch, public domain](https://commons.wikimedia.org/wiki/File:Blue_ink_pen.jpg) and [Blue Ballpoint Pen, ChanakaW, CC BY 3.0](https://commons.wikimedia.org/wiki/File:Blue_Ballpoint_Pen.jpg). Images remain in ignored local test data and are not included in source artifacts.
