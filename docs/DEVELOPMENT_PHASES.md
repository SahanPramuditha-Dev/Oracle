# ORACLE development phases

## Current increment — connected UI acceptance, 5 November 2026

The replacement Presence UI is implemented and connected to FastAPI for chat, voice, camera, notes, reminders and image memories. PostgreSQL remains the durable record store. See [current integration evidence](FRONTEND_BACKEND_INTEGRATION.md).

The live read-only integration gate passes all ten readiness checks. Additional browser acceptance verifies sleep cancellation without losing existing conversation, camera-denial fallback, and recovery after a backend failure. Physical printed-label and human microphone/speaker acceptance remain pending; no sensor was activated for these checks. Phase 7 is software-verified within these bounds, not fully accepted on hardware or performance.

The next development stream is Phase 8, assistant tools and desktop workflows. Some desktop controls already exist in newer code and must be audited before expanding them. Prioritize the still-missing sourced search and document-grounded question workflows; do not rebuild existing chat, OCR, notes or action confirmation. Background reminder delivery belongs to Phase 9 and remains absent. The 4 November full-scope inventory is historical and requires a fresh implementation audit before its counts are used as current totals.

## Scope boundary — initial prototype, not the complete ORACLE product

Phases 0–7 below cover three narrow demonstration slices. Reaching Phase 7 does not complete the 133-capability inventory or the 24 broad integrated journeys. The 4 November source audit classifies 14 entries as implemented software within stated limits, 24 as partial and 95 as not implemented. No broad J01–J24 journey is fully accepted as originally specified. Counts are not weighted completion percentages.

See [full-scope feature/scenario audit](FULL_SCOPE_AUDIT.md) for all 133 consolidated features, all 24 integrated journeys and all 70 legacy scenarios. It proposes explicit continuation streams 8–18 instead of hiding the remaining product under one extensions phase. Those streams retain the original ideas and need release-scope selection and estimates; they are not an approved delivery commitment.

Updated 4 November 2026. The user authorized phase progression with Ollama deferred. Phase 2 text and approved actions is complete for the current Gemini provider path. Phase 3 productivity and records and Phase 3.1 PostgreSQL migration are complete, with SQLAlchemy access and Alembic migrations. Phases 4 and 5 now have implemented, tested software paths for local image reading and approved image memory. Physical camera preview is verified; printed-label acceptance remains open. Phase 6 local voice software is implemented, with human microphone/speaker acceptance deferred. Phase 7 integration checks have started.

## Current phase gates

Phase 8 now includes [research tools](PHASE_8_RESEARCH.md): Wikipedia discovery, a configurable local SearXNG adapter, TXT/Markdown/PDF evidence retrieval and local-model answers with validated references and quotes. PDF page references are retained. Live Wikipedia access is blocked by its robot policy; SearXNG has no installed instance yet. Phase 8 remains partial: general search live acceptance, semantic retrieval and full-document coverage remain open.

| Gate | Status | Remaining work |
|---|---|---|
| Phase 0 — local & cloud readiness | Complete | Ollama local model and Gemini cloud both operational. |
| Phase 1 — UI and application foundation | Technically complete | User visual approval is not implied. |
| Phase 2 — text and approved actions | Complete | Local Ollama provider and Gemini cloud provider both supported; operating-system launch requests do not promise a window is ready. |
| Phase 3 — productivity and records | Complete for the defined local records increment | No background notification service or external calendar integration is claimed. |
| Phase 3.1 — PostgreSQL migration | Complete | Live PostgreSQL, verified copy, restart persistence and backup/restore; SQLite source retained. |
| Phase 4 — camera and reading | Software implemented; device acceptance open | Physical preview/stop verified at 1280×720; printed-label capture remains open. |
| Phase 5 — approved image memory | Software implemented; device scenario open | Save/find/correct/delete pass through PostgreSQL with fixture images; repeat the journey on a physical capture. |
| Phase 6 — local push-to-talk voice | Software implemented; hardware acceptance deferred | Local recording/transcription, transcript review, Windows speech and interruption pass software tests. User deferred the human microphone test. |
| Phase 7 — integrated prototype | Connected software paths verified; acceptance partial | Live readiness and browser integration pass; physical journeys, complete offline/resource acceptance and clean setup checks remain open. |
| Phase 8 onward — broader product | Mostly undeveloped | See the full-scope audit and proposed streams 8–18; do not treat remaining inventory as completed or discarded. |

### Phase 2 acceptance evidence

- Local app/URL proposals require explicit confirmation; unknown targets, expiry and replay are rejected.
- Polite open/launch/start commands use the same authenticated backend action path.
- Actual tool outcomes enter the transcript and bounded follow-up context; Clear resets the session and Stop prevents late replies.
- A real Notepad launch was confirmed through the UI and a Notepad window appeared. Calculator accepted a launch request but its window was not independently observed; that is not reported as a successful visible Calculator launch.
- Provider failure and session isolation have deterministic coverage; no Ollama work was performed.

### Phase 3 acceptance evidence and limits

- Authenticated note create/search/edit/delete and timer/reminder create/list/snooze/delete endpoints now use PostgreSQL through SQLAlchemy. The original SQLite source is retained as a cutover snapshot.
- A real backend process restart preserved a saved note and reconciled an overdue timer. Temporary acceptance records were removed. Local evidence: `data/readiness/phase3-records-gate.json`.
- The UI uses backend records, acknowledges actual save results and retains drafts on failure. Browser-only task records can be explicitly imported; import is atomic and idempotent and preserves overdue due times.
- Type `notes`, `find notes <words>` or `save note Title: text` to work locally. The note UI/commands do not enter Gemini conversation history.
- Alerts are displayed while the interface is open and refresh from backend time every five seconds while visible. Reopening reconciles overdue records. No alarm while ORACLE is closed or Windows is asleep is promised.
- Preferences stay browser-local; conversation is page-local. Neither is a substitute for durable productivity storage.
- This is one local user's database behind the existing authenticated boundary, not a multi-user service. Use the PostgreSQL dump helper for backups; no encrypted-at-rest storage is claimed.

Validation for this increment: **84 backend tests and 38 browser tests passed**, along with frontend build and lint. The existing lazy vision bundle size warning and the test-client deprecation warning remain non-blocking.

### Phase 3.1 acceptance evidence

The active gateway reports PostgreSQL storage. ORACLE uses an application-owned loopback cluster from the installed PostgreSQL 18 binaries; other PostgreSQL services were not changed. SQLAlchemy handles parameterized access, connection pooling and transactions; Alembic records schema revision `0001_productivity`. Record limits remain atomic under concurrent PostgreSQL writes.

The cutover source held zero notes and zero tasks. Nonempty transfer, repeatable import and conflict rollback were tested separately against real PostgreSQL. A real database restart preserved a temporary note and reconciled a due timer. A custom-format backup was restored into an isolated disposable database and its records verified. Temporary application records and test schemas/databases were removed. Evidence: ignored `data/readiness/postgres-gate.json`. See [database operations](DATABASE.md) for setup, backups and recovery limits.

### Phases 4 and 5 implementation evidence

Authenticated still-image reading now supports crop selection, local RapidOCR inference, OpenCV QR decoding, correction and explicit note saving. Reading does not archive an image or contact Gemini. Explicit memory saving stores a normalized image, corrected description, submitted original OCR text, source kind and backend save time in PostgreSQL. Alembic revision `0002_image_memory` manages the schema. Keyword search, viewing, editing and deletion include the image asset lifecycle.

Connected tests use real local OCR/QR and PostgreSQL for image memory, rather than scripted product results. Denied-camera file selection, upload limits, invalid crops, busy inference, inert QR contents and late-result cancellation are covered. Physical permission/focus and real printed-label acceptance remain unverified; no 100% hardware sign-off is claimed. A real PostgreSQL/backend restart and isolated backup restore preserved an image memory and its asset hash; temporary fixtures were removed. See [camera reading and memory](CAMERA_READING_AND_MEMORY.md) for operation and limitations.

### Phase 6 implementation and Phase 7 start

Local voice now records an explicit utterance, transcribes it in FastAPI with a prepared tiny English model, shows an editable transcript before Send, and synthesizes Windows speech for client playback. No runtime speech-model download, cloud ASR fallback or Ollama work occurs. Existing browser speech remains an explicit separate choice. Stop prevents late playback; audio and text limits are enforced by the backend.

The physical camera preview check passed at 1280×720 and the camera was stopped. No camera frame was captured or saved. A real printed-label journey remains open. The user explicitly deferred the human microphone test; synthetic audio does not close human speech/speaker acceptance. See [local voice](LOCAL_VOICE.md).

Phase 7 now has `scripts/check_integration.py`: an authenticated read-only check of gateway, PostgreSQL, image features and local speech readiness, with no sensor activation, cloud generation or OS action. This is groundwork rather than full integration sign-off.

## First version

Demonstrate three connected journeys:

1. Ask by text to open an approved program or website, save a note and start a timer.
2. Capture a label, read its text, explicitly save the image and description, then find the memory later.
3. Ask by voice for an already supported action, see its transcript, hear the result and interrupt playback.

General image recognition, saved-place pins and a local document question are follow-on demonstrations after the text, OCR and memory path works. Initial language is English, subject to the user's final scope choice. Optional ideas remain in the full feature and scenario registers.

## Phase plan

Effort ranges are provisional focused developer-days, not calendar promises. They exclude learning time, unavailable hardware and university review. Re-estimate after each demonstration. The core Phases 0 to 7 total roughly 31 to 57 developer-days before optional work and academic research.

| Phase | Work | Dependency | Initial effort range | Exit demonstration |
|---|---|---|---|---|
| 0 Readiness | Confirm device, initial scope, runtime compatibility; local model is separately deferred | None | 2 to 3 days | Record environment and compatible runtime; record model evidence only when that increment is resumed |
| 1 Foundation | Frontend, backend, connection state, authenticated boundary and configuration | Non-Ollama readiness | 3 to 5 days | Browser connects; unavailable backend and unauthorized client handled |
| 2 Text and actions | Local conversation, session context, app and website opening, stop and tool outcomes | 1 | 4 to 7 days | One request executes a mapped action and rejects unknown targets |
| 3 Productivity and records | SQLite, notes, task status, timers and reminder due times | 2 | 3 to 5 days | Save and retrieve a note across restart; reconcile overdue reminders |
| 4 Camera and reading | Permission, manual still capture, selected crop, OCR and QR preview | 1 and selected context from 2 | 5 to 9 days | Read a real label; a scanned QR never opens itself |
| 5 Approved memory | Explicit image save, provenance, keyword retrieval, correction and deletion | 3 and 4 | 5 to 9 days | Save a label photo, find it later and remove it from storage and search |
| 6 Push to talk voice | Transcription, visible transcript, local speech output and interruption | 2 and hardware feasibility | 5 to 10 days | Speak a supported command and stop output without late audio resuming |
| 7 Integrated prototype | Clean setup, failures, offline behaviour, resource checks and user instructions | 3 to 6 | 4 to 9 days | All three selected journeys work with recorded limits |
| 8 onward Full-product streams | Assistant/desktop tools, calendars/workspaces, maps, visual workflows, connected memory, people, proactive features, selected specialist and platform work | Shared foundations and explicit release allocation | Not yet estimated | Each selected original journey passes its own full acceptance check; see FULL_SCOPE_AUDIT.md |

Work in small increments inside each phase. Do not install the entire AI stack before the first interface and action work. Keep notes and update documentation alongside development.

## Phase zero tasks

- Record CPU, RAM, GPU if present, OS, free disk, camera and microphone.
- Check compatible Python and Node versions against current package requirements.
- Deferred from this gate: local model selection/setup. Retain the historical model/license evidence without running or downloading Ollama.
- When the deferred local-model increment resumes, verify model identifier, quantization, context, latency and memory evidence before provider integration.
- Confirm initial approved programs, permitted file roots and the three demonstration journeys.
- Record university deadline and research expectations when known.
- If inference is too slow, reduce model size or context and simplify the demo before considering any purchase.

## Phase one tasks

1. Create separate backend and frontend folders using the proposed layout in the readiness guide.
2. Add configuration examples, dependency locks, ignore rules and startup instructions without secrets.
3. Implement minimal health and capability reporting with observable failure states.
4. Build a text input, transcript, connection indicator and stop button.
5. Add authentication and schema validation before any computer action endpoint.
6. Record a clean start and failed connection test. A decorative visualizer is optional.

## Phase 1 requirement-by-requirement verification

Checked 4 November 2026 against the implementation and the current foundation-gate evidence, rather than the phase label alone.

| Step | Status | Implementation / verification |
|---|---|---|
| 1. Separate frontend and backend | Complete | `frontend/src` and `backend/app` exist. Proposed deeper feature folders remain optional later organization. |
| 2. Configuration, locks, ignore rules and startup guide | Complete | Backend environment example, Python project/lock, npm package/lock, secret/data ignore rules, startup helper and root README exist. |
| 3. Health, capabilities and observable failure | Complete | Live health/capability endpoints; gateway/provider availability errors and offline UI are covered. |
| 4. Text input, transcript, connection and stop | Complete | On-demand conversation panel, real transcript, gateway status and abort control implemented; browser checks cover cancellation and viewports. |
| 5. Authentication and schema validation | Complete | Server-only bearer injection, allowed-origin boundary, request-size/text/context validation; unauthorized/foreign/invalid requests are tested. |
| 6. Clean startup and failed-connection evidence | Complete | Fresh isolated gateway health and HTTP 401 recorded; existing browser offline case disables sending and reports failure. |

Latest full validation: 39 backend tests and 26 browser tests passed, with build/lint and dependency consistency checks passing. Evidence: `data/readiness/foundation-gate.json` (ignored local runtime record). No Phase 1 implementation step remains open. Ollama and user visual approval are not asserted by this technical verification.

## Cross-phase acceptance — apply at the relevant phase

The following is the acceptance checklist for the complete roadmap, not an additional set of Phase 1 prerequisites. Durable records belong to Phase 3, OCR/QR to Phase 4, memory to Phase 5, physical voice acceptance to Phase 6 and integrated offline/resource acceptance to Phase 7. They remain requirements for those phases.


| Area | Minimum check |
|---|---|
| Actions | Unknown program and outside-root file requests are rejected; replay does not repeat an action |
| Conversation | Follow-up stays in the right session; unavailable model produces an honest error |
| Productivity | Stored note survives restart; timer cancellation and reminder availability are clear |
| Camera | Permission denial has an alternative; shutter stops capture; oversized upload is rejected |
| OCR and QR | Errors can be corrected; undecodable input is reported; QR payload is previewed |
| Memory | Save is explicit; answer shows source time; correction and deletion affect retrieval and linked assets |
| Voice | Transcript is visible; denied mic permits typing; stop prevents stale playback |
| Privacy | No raw streams or secret values remain in default logs or storage |
| Offline | Local functions work as declared; external lookups fail without inventing results |

Use focused automated checks for action validation, storage lifecycle and retry behaviour, plus manual camera and voice demonstrations. Record actual results rather than checking boxes based on intended behaviour.

## Research and academic work

Implementation milestones do not replace the degree's research requirement. A candidate experiment is keyword versus semantic memory retrieval with time filters. Decide the research question, dataset, baseline, consent process and held-out evaluation with the supervisor before collecting participant data. Do not assume the source guide's proposal to train four models is mandatory. Add academic milestones after the deadline and assessment requirements are confirmed.

## Deferred work

Wake-word standby, continuous monitoring, gestures, routes, people matching, proactive learning, specialist classifiers, native Android, glasses and emergency detection are not needed to start. Introduce them only after a scope decision, feasibility check and estimate. Keep their ideas in the inventory rather than deleting them.

## Working rhythm

At the end of each working session record what changed, what was demonstrated and what remains uncertain. Review one connected journey weekly. Commit small completed changes, keep approved sample data separate from personal data, and reserve time for setup, failure handling and report notes. When scope grows, identify displaced work before adding it to a phase.
