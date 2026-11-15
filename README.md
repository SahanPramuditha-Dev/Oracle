# ORACLE

Oracle Central is a local-first Windows assistant with a React Presence interface and a FastAPI gateway. Start with the [documentation index](docs/README.md) for setup, feature guides and the current development status.

## Development snapshot

The November working tree includes Atlas maps and routing, an integrated Android Companion gateway, camera and product recognition, local voice, direct answers, records, identity and protocols, and optional Google Calendar and Tasks integration. Some of these changes are still local. Use the commit history of your checkout to determine which implementation is available.

See the [development roadmap](docs/ORACLE_ROADMAP.md) for working-tree capabilities, matched Companion build instructions and remaining device tests. The [development status](docs/DEVELOPMENT_STATUS.md) records dated verification. The [requirements register](docs/02-requirements/COMPLETE_FEATURE_LIST.md) describes the full product scope.

## License and third-party notices

ORACLE source code is released under the [MIT License](LICENSE). Model files,
provider APIs and downloaded assets have separate terms; see
[third-party notices](THIRD_PARTY_NOTICES.md) before redistribution or
commercial deployment. The notice also covers browser APIs, Google Fonts,
Ollama, PostgreSQL, model providers and the pinned vision assets.
The notices also record the legacy dormant-page CDN dependency.

## Homepage preview

![ORACLE Presence homepage](Screenshots/Img%201%20Homepage.png)

## Local AI and Vision Configuration

Oracle supports **Local Ollama** (offline, zero-cost, private text & vision) and **Google Gemini** (cloud fallback) through a unified provider interface.

Configure your provider preference in `backend/.env`:

```env
# Set primary AI provider ('ollama' or 'gemini')
AI_PROVIDER=ollama

# Local Ollama configuration
OLLAMA_ENABLED=true
OLLAMA_MODEL=qwen2.5:1.5b
OLLAMA_VISION_MODEL=moondream
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Gemini configuration (optional fallback)
GEMINI_ENABLED=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite-preview
```

### Model downloads and local connections

Runtime model files and credentials are intentionally excluded from Git. Set
up only the providers and models needed for the workflow you want:

```powershell
# Optional local text and vision chat models
ollama pull qwen2.5:1.5b
ollama pull moondream

# Optional local ONNX vision models (from the repository root)
.\backend\.venv\Scripts\python.exe .\scripts\prepare_vision_models.py
.\scripts\prepare_object_models.ps1

# Optional local English speech-to-text model
.\backend\.venv\Scripts\python.exe .\scripts\prepare_voice_model.py
```

The Ollama service must be available at `http://127.0.0.1:11434` when
`AI_PROVIDER=ollama`. The development launcher starts Ollama when it is
installed and not already running. Local inference assets are stored under
`models/` and are never downloaded automatically by backend requests.

For Google Calendar, Tasks and timed-reminder access, configure the ignored
`backend/google-client.json`, enable the required APIs and complete the OAuth
flow from **Workspace → Google**. Follow the [Google Workspace connection
guide](docs/GOOGLE_WORKSPACE_CONNECTION.md); credentials and refresh tokens
are stored locally and are not committed.

Research search is local by default. If a local SearXNG instance is available,
set `ORACLE_SEARXNG_URL` in `backend/.env` and enable its JSON format. See
[Phase 8 research](docs/PHASE_8_RESEARCH.md) for the adapter limits and
provider behavior. Gemini is optional and requires `GEMINI_API_KEY` only when
`AI_PROVIDER=gemini` and `GEMINI_ENABLED=true`.

### Natural Voice & Speech Endpoints
* **`POST /api/v1/voice/speak`**: Generates high-fidelity, emotional, and human-like speech from text using local **Kokoro-82M** ONNX (`af_heart`, `af_bella`, `am_adam`, etc.) with automatic fallback to Windows SAPI. Accepts optional `voice` and `speed` parameters.
* **`GET /api/v1/voice/voices`**: Lists all 54 available neural voice profiles and reports the active speech synthesis engine.
* **`POST /api/v1/voice/transcribe`**: Local push-to-talk speech-to-text using Faster-Whisper with Silero VAD.

### Voice models and libraries

| Capability | Model/engine | Libraries and runtime |
|---|---|---|
| Speech-to-text | `Systran/faster-whisper-tiny.en` stored in `models/whisper-tiny.en` | `faster-whisper==1.2.1`, CTranslate2, PyAV (`av`) for audio decoding, NumPy, CPU `int8` inference |
| Neural speech synthesis | Kokoro-82M ONNX: `models/voice/kokoro-v1.0.onnx` and `voices-v1.0.bin` | Optional `kokoro-onnx` and `soundfile`; used only when both model files and packages are available |
| Windows speech fallback | Installed Windows SAPI voices | `pywin32==312` / `win32com`; no model download required |
| Browser speech option | Browser-provided speech capability | Optional browser path; it is not the offline backend voice engine |

Voice transcription is local-only, uses prepared files, and does not download
models at runtime. Run `scripts/prepare_voice_model.py` to prepare the tiny
English recognition model. Kokoro files are optional; without them, Windows
uses SAPI when `pywin32` is available. The backend does not silently fall back
to a cloud speech provider.

### Vision & People Recognition Endpoints

See [people recognition and verification](docs/PEOPLE_RECOGNITION.md) for stable identity/sample storage, explicit categories, matching states and access boundaries. Face matches do not authorize access.
* **`POST /api/v1/people/enroll?name=...&notes=...`**: Enroll an individual (e.g., "Sahan", "Elon Musk") with a photo. Detects the face via YuNet, computes a 128-d biometric feature vector via SFace, and stores it in PostgreSQL with privacy preservation.
* **`GET /api/v1/people`**: List all enrolled individuals (without exposing raw biometric vectors).

### Administrator Protocol

Open **Admin Protocol** from Workspace or the status menu, or say or type “Activate Admin Protocol.” The enrolled administrator must match the face scan and then record the exact phrase shown by Oracle. The phrase is issued for one attempt. A failed voice check requires a fresh attempt. Clearance lasts five minutes in the current window. Use **End administrator clearance** in the status menu or say “Lock admin” to revoke it early.

The first administrator can be provisioned locally. Enroll a standard identity with consent, capture three face samples, and add a voice sample in **System Settings**. From the repository root, use the existing local gateway maintenance credential to promote that profile. Replace the profile ID and use your configured local gateway address.

```powershell
$oracleProfileId = 'person_REPLACE_WITH_ENROLLED_PROFILE_ID'
$oracleGateway = 'http://127.0.0.1:8000'
$oracleMaintenanceToken = (Get-Content -Raw -LiteralPath 'data/dev/api-token').Trim()
Invoke-RestMethod -Method Patch -Uri "$oracleGateway/api/v1/people/$oracleProfileId" `
  -Headers @{ Authorization = "Bearer $oracleMaintenanceToken" } `
  -ContentType 'application/json' -Body '{"permission":"administrator"}' | Out-Null
Remove-Variable oracleMaintenanceToken
```

### Lockdown Protocol

Select **Protocol LOCKDOWN** in Workspace or say or type “Activate Lockdown.” Oracle revokes active administrator grants, cancels verification attempts and queued desktop actions, and restricts new desktop actions. The status menu reports Oracle's restriction and the Windows lock request separately.

Unlock Windows using its usual sign-in, then verify through **Admin Protocol** to resume desktop actions and gateway chat. The restriction lives in the running gateway process. Restarting that process resets the restriction and discards any remaining grants and queued actions.

### Ghost Protocol

Select **Protocol GHOST** in Workspace or say or type “Enable Ghost mode.” Oracle hides its private panels, captions, and reminder previews, closes camera and biometric capture, and pauses voice input in the current window. Select **Exit Ghost mode** to restore the interface and your configured voice mode. Reopen the camera manually when needed.
* **`POST /api/v1/people/identify?threshold=0.40`**: Detects all faces in an incoming image and compares their embeddings against the enrolled gallery in ~50ms using cosine similarity. Returns matched names, bounding boxes, and confidence levels.
* **`POST /api/v1/people/verify?person_id=...`**: Compare one face against the selected identity’s enrolled samples; results expire after 30 seconds and do not grant access.
* **`DELETE /api/v1/people/{person_id}`**: Remove an enrolled individual from local storage.
* **`POST /api/v1/vision/detect`**: High-speed (<45ms) person and object detection with bounding boxes powered by local `yolov8n.onnx` via ONNX Runtime. Returns detected objects, confidence scores, bounding boxes `[x, y, w, h]`, and `person_count`.
* **`POST /api/v1/vision/ask?prompt=...`**: Conversational visual question answering powered by local `moondream` in Ollama. Runs 100% locally on your GPU with `cloud_requests: False`.
* **`POST /api/v1/images/read`**: Local OCR & QR decoding using RapidOCR and OpenCV.

A request served by the local Ollama instance runs on this machine. CPU and GPU usage depend on the hardware and Ollama configuration. Gemini, Google Workspace and network-backed research or maps use external services when configured or requested.

For conversational answers the app sends the current text plus up to ten recent user and assistant messages, each context item trimmed to 1200 characters. Exact supported app-open commands are handled locally.

Requests use a 512-token output cap, one active generation and a 50-attempt limit per UTC day per backend process. That counter resets on restart and is a development guard, not a billing guarantee. Quota errors are shown without retries or paid-provider fallback. No billing or subscription was enabled. See [Google's pricing](https://ai.google.dev/gemini-api/docs/pricing) before changing models or account settings.

## Start the workspace

Run `run-system.bat` from a checkout containing the Windows launcher. For separate backend and frontend terminals, run the following from the project folder in PowerShell:

```powershell
.\scripts\start-dev.ps1
```

The launcher creates an ignored random local credential, starts the managed ORACLE PostgreSQL cluster if present, and starts the backend at http://127.0.0.1:8000. Press Ctrl+C in the launcher terminal to stop.

In a second terminal, start the Presence frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173. If that port is unavailable on Windows, `run-system.bat`
automatically uses http://127.0.0.1:3000 instead. For separate backend terminals, run preparation once, then:

```powershell
.\backend\.venv\Scripts\python.exe scripts\prepare_dev.py
# Backend
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Recreate the development environment

```powershell
py -3.12 -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
```

Python 3.12.10 was used. The backend environment snapshot records tested dependencies.

## Checks

```powershell
# Backend tests, from backend/
.\.venv\Scripts\python.exe -m pytest -q

# Frontend build and browser checks, from frontend/
npm run build
npm run test:e2e
```

Run browser checks with both services running and Microsoft Edge installed.

## Planning and development guides

- [Documentation index](docs/README.md)
- [Technology and architecture](docs/STARTER_TECHNOLOGY_AND_ARCHITECTURE.md)
- [Development phases](docs/DEVELOPMENT_PHASES.md)
- [Readiness checklist](docs/DEVELOPMENT_READINESS.md)
- [Frontend/backend integration](docs/FRONTEND_BACKEND_INTEGRATION.md)
- [Google Workspace connection](docs/GOOGLE_WORKSPACE_CONNECTION.md)
- [Full-scope audit](docs/FULL_SCOPE_AUDIT.md)

## Local Python environment

The backend environment uses the existing Python 3.12 installation. From this folder in PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe --version
```

No backend dependencies are required for the Phase 0 benchmark. After Ollama is installed and running locally with the chosen model downloaded:

```powershell
.\backend\.venv\Scripts\python.exe scripts\benchmark_local_model.py
```

This benchmark sends a fixed nonpersonal prompt to the local loopback endpoint. It records two sequential requests, model metadata, elapsed time and generation statistics under ignored `data/readiness/`. It is a smoke test, not a quality evaluation or a measurement of peak memory.

Ollama 0.40.14 is installed with cloud features disabled. The qwen2.5:1.5b model passed the local GPU smoke test; detailed results are recorded in development status.
