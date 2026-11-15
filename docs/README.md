# ORACLE documentation

The [development roadmap](ORACLE_ROADMAP.md) is the current working-tree capability and release checklist for Oracle Central, Atlas and Android Companion. The [development status](DEVELOPMENT_STATUS.md) records dated test evidence and integration limits. Documented working-tree changes may need a newer checkout than the public branch.

## Run and verify

Follow the root [README](../README.md) for environment setup and startup.
The backend runs at `http://127.0.0.1:8000`; the Vite frontend runs at
`http://127.0.0.1:5173` and proxies `/api` requests to the backend.

## Implementation guides

- [Design system and color theme](DESIGN_SYSTEM.md)
- [Atlas maps and location intelligence](MAPS_AND_LOCATION_INTELLIGENCE.md)
- [Companion build, pairing and roadmap](ORACLE_ROADMAP.md#existing-companion-build-baseline--15-november-2026)
- [Live object detection](LIVE_OBJECT_DETECTION.md)
- [Product identification](PRODUCT_INTELLIGENCE.md)
- [Vision and foreground separation](VISION_IMPROVEMENTS.md)
- [Camera audit and device checks](CAMERA_AUDIT.md)
- [Performance audit](SYSTEM_PERFORMANCE_AUDIT.md)
- [Frontend/backend integration](FRONTEND_BACKEND_INTEGRATION.md)
- [Google Workspace connection](GOOGLE_WORKSPACE_CONNECTION.md)
- [Database operations](DATABASE.md)
- [Camera reading and approved image memory](CAMERA_READING_AND_MEMORY.md)
- [Local voice](LOCAL_VOICE.md)
- [People recognition](PEOPLE_RECOGNITION.md)
- [Phase 8 research](PHASE_8_RESEARCH.md)

## Maintain the documentation

- Update the affected setup or feature guide in the same change as its commands, settings, routes, or behavior.
- Update the roadmap when implementation status changes. Record validation in the development status with the date, tested revision or working-tree state, and the checks run. Record phone or hardware acceptance only after testing on the device.
- Review the index when adding or moving a guide. Keep original requirements and dated evidence available for reference.

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
