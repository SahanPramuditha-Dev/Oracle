# ORACLE documentation

This folder contains the current implementation guides, phase evidence and the
original product scope. ORACLE is an early local single-user assistant; the
implemented software is narrower than the full feature inventory.

## Current status

The Presence frontend is connected to the FastAPI backend. PostgreSQL stores
notes, tasks and image memories; the current conversation and unsaved drafts
remain page-local. Local OCR/QR reading, voice software, person/object
recognition, research retrieval and the bounded Google Calendar/Tasks connector
are implemented. Physical camera, microphone and speaker acceptance remains
open.

The latest increment passed 146 backend tests, 11 browser integration tests, 3
Google browser tests and the production frontend build. These checks cover
bounded implemented paths, not the complete product scope. See
[development status](DEVELOPMENT_STATUS.md) for dated evidence and
[frontend/backend integration](FRONTEND_BACKEND_INTEGRATION.md) for runtime
boundaries.

## Run and verify

Follow the root [README](../README.md) for environment setup and startup.
The backend runs at `http://127.0.0.1:8000`; the Vite frontend runs at
`http://127.0.0.1:5173` and proxies `/api` requests to the backend.

## Implementation guides

- [Frontend/backend integration](FRONTEND_BACKEND_INTEGRATION.md)
- [Google Workspace connection](GOOGLE_WORKSPACE_CONNECTION.md)
- [Database operations](DATABASE.md)
- [Camera reading and approved image memory](CAMERA_READING_AND_MEMORY.md)
- [Local voice](LOCAL_VOICE.md)
- [People recognition](PEOPLE_RECOGNITION.md)
- [Phase 8 research](PHASE_8_RESEARCH.md)

## Planning and scope

- [Development status](DEVELOPMENT_STATUS.md)
- [Development phases](DEVELOPMENT_PHASES.md)
- [Development readiness](DEVELOPMENT_READINESS.md)
- [Technology and architecture](STARTER_TECHNOLOGY_AND_ARCHITECTURE.md)
- [Full-scope audit](FULL_SCOPE_AUDIT.md)
- [Project overview](01-project/PROJECT_OVERVIEW.md)
- [Scope decisions](01-project/SCOPE.md)
- [Feature inventory](02-requirements/COMPLETE_FEATURE_LIST.md)
- [Use cases](02-requirements/USE_CASES.md)

The original planning material remains useful for scope context, but its
proposals are not promises that every listed feature is implemented.
