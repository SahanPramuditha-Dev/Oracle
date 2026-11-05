# Third-party notices

ORACLE source code is licensed under the [MIT License](LICENSE). This file
records the principal third-party libraries, services and model assets used by
the application. Their own licenses and terms continue to apply; the project
license does not relicense third-party material.

## Python and backend libraries

These are pinned in [`backend/requirements.lock.txt`](backend/requirements.lock.txt)
and declared in [`backend/pyproject.toml`](backend/pyproject.toml):

- [FastAPI](https://github.com/fastapi/fastapi) — MIT
- [Uvicorn](https://github.com/encode/uvicorn) — BSD-3-Clause
- [Pydantic](https://github.com/pydantic/pydantic) — MIT
- [HTTPX](https://github.com/encode/httpx) — BSD-3-Clause
- [python-dotenv](https://github.com/theskumar/python-dotenv) — BSD-3-Clause
- [SQLAlchemy](https://github.com/sqlalchemy/sqlalchemy) — MIT
- [Alembic](https://github.com/sqlalchemy/alembic) — MIT
- [Psycopg](https://github.com/psycopg/psycopg) — PostgreSQL License
- [RapidOCR](https://github.com/RapidAI/RapidOCR) — Apache-2.0
- [OpenCV](https://opencv.org/license/) — Apache-2.0
- [Pillow](https://github.com/python-pillow/Pillow) — HPND
- [PyAV](https://github.com/PyAV-Org/PyAV) — BSD-3-Clause
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — MIT
- [CTranslate2](https://github.com/OpenNMT/CTranslate2) — MIT
- [NumPy](https://github.com/numpy/numpy) — BSD-3-Clause
- [ONNX Runtime](https://github.com/microsoft/onnxruntime) — MIT
- [PyWin32](https://github.com/mhammond/pywin32) — PSF-2.0
- [pypdf](https://github.com/py-pdf/pypdf) — BSD-3-Clause

Transitive dependencies may have additional notices. Regenerate the lock file
and review upstream notices when dependencies change.

## Frontend libraries and tooling

These are declared in [`frontend/package.json`](frontend/package.json) and
[`frontend/package-lock.json`](frontend/package-lock.json):

- [React](https://github.com/facebook/react) — MIT
- [React DOM](https://github.com/facebook/react) — MIT
- [Vite](https://github.com/vitejs/vite) — MIT
- [TypeScript](https://github.com/microsoft/TypeScript) — Apache-2.0
- [Framer Motion](https://github.com/motiondivision/motion) — MIT
- [Lucide](https://github.com/lucide-icons/lucide) — ISC
- [Three.js](https://github.com/mrdoob/three.js) — MIT
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) — MIT
- [VAD Web](https://github.com/ricky0123/vad) — review the package license
- [Playwright](https://github.com/microsoft/playwright) — Apache-2.0

## Model assets and model providers

Model files are downloaded into ignored local directories and are not included
in this repository. Before redistributing a model or a product containing it,
review the current model card, license and any commercial-use restrictions.

- [Ollama](https://ollama.com/) runtime; configured models include
  `qwen2.5:1.5b` and `moondream`. Model terms are set by their respective
  model publishers.
- [Qwen2.5](https://huggingface.co/Qwen/Qwen2.5-1.5B) model card and license.
- [Moondream](https://huggingface.co/vikhyatk/moondream2) model card and
  license.
- [faster-whisper tiny English](https://huggingface.co/Systran/faster-whisper-tiny.en)
  model repository and license.
- [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) runtime and
  model assets, when optionally installed under `models/voice/`.
- YOLOv8 ONNX exports and YOLO-World/CLIP assets downloaded by
  [`scripts/prepare_vision_models.py`](scripts/prepare_vision_models.py) and
  [`scripts/prepare_object_models.ps1`](scripts/prepare_object_models.ps1).
  Review [Ultralytics licensing](https://www.ultralytics.com/license) and each
  Hugging Face model card before redistribution.
- OpenCV Zoo YuNet and SFace assets used for face detection and recognition.
  Review the [OpenCV Zoo repository](https://github.com/opencv/opencv_zoo) and
  each model's license before redistribution.

## External APIs and services

These integrations are optional and have their own usage, attribution, rate
limit and privacy terms:

- [Google Gemini API](https://ai.google.dev/gemini-api/docs) — Google API
  terms, model terms, quota and pricing apply when enabled.
- [Google OAuth, Calendar API and Tasks API](https://developers.google.com/workspace)
  — Google API Services User Data Policy and OAuth consent requirements apply.
- [Wikipedia MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page) —
  follow Wikimedia API and content attribution requirements.
- [SearXNG](https://docs.searxng.org/) — the configured local instance and its
  upstream search engines determine applicable terms and rate limits.

## Attribution and compliance checklist

1. Keep this file and the MIT license with source distributions.
2. Keep upstream copyright and license notices required by dependencies.
3. Do not commit credentials, downloaded model weights, database files or
   private runtime data.
4. Recheck model cards and API terms before commercial distribution, hosted
   deployment or redistribution of model files.

This notice is an engineering attribution record, not legal advice.
