# ORACLE development status

## Google connection increment — 5 November 2026

Combined flow update: one Google sign-in now requests identity plus Calendar/Tasks consent, verifies account email through Google UserInfo and detects popup completion automatically. All 146 backend tests, three Google browser tests and production build passed. After explicit approval for $0 setup, the ORACLE localhost OAuth client was created and its credentials saved in the ignored backend file; Calendar and Tasks APIs were enabled and visibly verified. Billing and paid quota were not changed. The live connector reports configured true; Google account consent is pending in the open account chooser. No live Calendar events or Tasks were changed.

Implemented a backend OAuth connection for Calendar, Tasks and Calendar-based timed reminders, plus Workspace → Google controls. The selected Firebase/Google Cloud project is `oracle-5ac86`. Offline access uses Google OAuth from that project; Firebase application sign-in and Google data permissions remain distinct. Full backend validation: 146 tests passed; three controlled-response Google browser tests and production build passed. The connector is configured locally, while final Google account consent remains an explicit user step. See [setup, supported behavior and evidence](GOOGLE_WORKSPACE_CONNECTION.md). This is a bounded Phase 9 connection increment; it does not complete calendars/workspaces or bidirectional sync.

## Phase 8 first increment — 5 November 2026

Follow-up: PDF extraction with page citations and local-model cited answers/selected-passage summaries are now implemented. Live local generation returned one validated claim; the full backend suite passed 139 tests. Search now supports a configured local SearXNG adapter, but no instance is installed/running, so broad-search live acceptance remains open. Retrieval is still lexical; full-document semantic coverage is not claimed. See [updated research scope](PHASE_8_RESEARCH.md).

Added authenticated Wikipedia source discovery and local TXT/Markdown passage retrieval through the existing conversation UI. Validation: 104 backend tests, 13 browser tests, ten live readiness gates and production build passed. Live Wikipedia requests are currently rejected by its robot policy; search acceptance is open. Document retrieval is literal evidence with line/column references, not semantic Q&A or an AI summary. See [Phase 8 research scope](PHASE_8_RESEARCH.md). No new model downloads or paid APIs were used.

## Current increment — connected UI acceptance, 5 November 2026

Latest acceptance increment: all ten live backend readiness checks passed. Three additional browser scenarios passed: sleep cancels a pending reply while preserving existing conversation; denied camera permission retains file attachment and records access; a failed backend response ends waiting and allows recovery. These use controlled responses/permission denial, not real sensor activation. Physical printed-label and human microphone/speaker checks remain pending. Phase 8 is the next expansion stream; audit newer desktop-control code before treating the historical inventory as current.

The replacement Presence frontend now connects chat, voice, camera, notes, reminders and memories to FastAPI. Backend validation for this integration: 97 tests passed with PostgreSQL configured. See [integration details and boundaries](FRONTEND_BACKEND_INTEGRATION.md). Physical microphone/speaker acceptance remains deferred.

The backend and stored records are retained. This bounded integration does not complete the broader feature inventory or all original scenarios.

## Full-project scope correction

Current phase progress refers to the initial prototype only. The full inventory remains substantially undeveloped: source audit counts are 14 implemented software entries, 24 partial and 95 not implemented out of 133 consolidated features. None of the 24 broad integrated journeys has full acceptance as originally written. Test totals below verify narrow implementation paths, not the full scenario register. See [full-scope audit and proposed continuation](FULL_SCOPE_AUDIT.md).

## Current authoritative gate — 4 November 2026

**Phases 0–2 are complete for the current non-Ollama/Gemini path. Phase 3 productivity and records and Phase 3.1 PostgreSQL migration are complete. Phases 4 and 5 software paths are implemented; physical camera/printed-label acceptance remains open. Phase 6 local voice software is implemented with human microphone/speaker acceptance deferred; Phase 7 integration has started.** Ollama was not installed, downloaded, run or configured in this increment.

The backend is FastAPI, not a browser-only simulation. It handles authorization, bounded AI requests, approved desktop actions PostgreSQL records and approved image memories through SQLAlchemy/Alembic, and local still-image OCR/QR. The UI reads and changes these records through authenticated endpoints. Preferences remain browser-local and the conversation remains page-local by design.

| Acceptance | Evidence |
|---|---|
| Text/action flow | Polite app/URL commands, bounded session context, errors, cancellation, single-use confirmation and actual tool outcomes implemented. |
| Actual desktop action | Confirmed Notepad through the live UI; a Notepad window appeared. Calculator dispatch was accepted, but no visible Calculator window is claimed. |
| Durable productivity records | PostgreSQL schema and Alembic revision, validated authenticated APIs, note search/edit/delete, task cancellation/snooze and overdue reconciliation. |
| Real restart | A note survived a real gateway restart and an expired timer returned as due. Evidence is in ignored `data/readiness/phase3-records-gate.json`; temporary records were removed. |
| Connected UI | Note lifecycle and failed-save draft preservation verified against the real gateway. Legacy browser tasks have an explicit idempotent import action. |
| Privacy | Note forms and local note commands bypass Gemini and its conversation context. Images are processed only on explicit read and retained only on explicit memory save; no sensor activation was added. |

Alerts require the interface to be open; visible pages poll every five seconds, and reopening reconciles overdue tasks. This is a local single-user store. Physical camera preview/stop is verified. Printed-label, human microphone/speaker and integrated acceptance remain open. User visual approval is not asserted.

See [phase gates](DEVELOPMENT_PHASES.md) for the current scope and limits. The dated sections below are historical and may describe earlier implementations superseded by this gate.

Validation for this increment: **84 backend tests and 38 browser tests passed**, along with frontend build and lint. The existing lazy vision bundle size warning and the test-client deprecation warning remain non-blocking.

## Local voice and integration start — 4 November 2026

Validation: 84 backend tests and 38 browser tests passed, with build/lint, dependency consistency and the read-only integration gate passing. Evidence: ignored `data/readiness/phase6-gate.json`.

- Added authenticated, bounded local transcription with a prepared tiny English CPU model; transcripts are reviewed before Send. No raw voice audio goes to Gemini and runtime never downloads a missing model.
- Added offline Windows SAPI speech generation and browser WAV playback with cancellation guards against late audio.
- Real synthetic SAPI→Whisper→approved-action tests and a network-blocked local voice test pass. No action is executed by transcription alone.
- Authorized physical camera preview reported 1280×720 and ready state 4, and was explicitly stopped. Continuous focus unsupported; no physical frame captured/saved. Printed-label acceptance remains open.
- User explicitly deferred the human microphone test. No microphone activation occurred for hardware acceptance.
- Phase 7 read-only integration gate reports healthy/authenticated gateway, PostgreSQL, image features and prepared local speech. Full integration remains open.
- [Operation and limitations](LOCAL_VOICE.md). Ollama was not downloaded, installed or run.

## Camera reading and approved memory — 4 November 2026

Final verification: 80 backend tests, 36 browser tests, build/lint and dependency checks passed. A real PostgreSQL/backend restart preserved image metadata and asset SHA-256; a separate backup restore preserved the same asset. Temporary active fixtures and the restore database were removed. Evidence: ignored `data/readiness/phase4-phase5-gate.json`.


Phase 4 provides capture/file input, crop controls, local CPU OCR/QR, editable results and explicit corrected-note saving. Phase 5 provides explicit image/description save, source/save-time display, keyword retrieval, image viewing, correction and transactional asset deletion. Images are normalized and stored with metadata in PostgreSQL under revision `0002_image_memory`; inference alone never creates an image memory.

Generated label tests use real packaged OCR models and real QR decoding. Connected browser tests use the live PostgreSQL backend for corrected notes and image-memory lifecycle. The first independent fixture read took approximately 1.8 seconds on this machine, not a general latency guarantee. Physical camera/printed-label checks remain open. [Operation and limits](CAMERA_READING_AND_MEMORY.md).

## PostgreSQL migration — 4 November 2026

- Provisioned an ORACLE-only SCRAM-authenticated cluster using installed PostgreSQL 18, listening on loopback port 55432. Generated credentials remain in ignored local files; the application role has no administrator privileges.
- Activated the PostgreSQL URL only after a consistent SQLite backup, transactional import and row verification. Existing source contained zero notes/tasks; nonempty copy and rollback checks use isolated test schemas.
- Real database restart preserved a note and reconciled an overdue timer. A backup was restored and checked in a disposable database. All temporary application fixtures were removed.
- Startup starts the managed cluster when needed. SQLAlchemy connections are bounded and disposed at gateway shutdown; PostgreSQL connection failures do not silently change databases.
- Current evidence: `data/readiness/postgres-gate.json`; [database operations](DATABASE.md). Ollama remains deferred.

## Functionality and performance refinement — 4 November 2026

- Task polling allows only one read at a time; a completed mutation cancels an older read before refreshing authoritative records. Stale responses cannot restore outdated task lists.
- Pending reads are aborted on unmount, polling skips hidden tabs, unchanged task lists retain their React reference, and visible countdown updates run once rather than twice per second.
- Local API requests retain a ten-second timeout even when a caller supplies a cancellation signal. Unreadable proxy responses produce a clear connection error.
- Timer duration is applied using backend time, preserving a full duration when browser time differs or a request is delayed. Absolute reminder times remain unchanged.
- SQLite note listing uses an ordering index instead of evaluating a text-search expression for every record when the query is empty. Search remains literal and bounded.
- Out-of-range or non-integer timestamps are rejected as validation errors before SQLite writes.
- Database engine and Ollama configuration were not changed. This is functional/request-efficiency verification, not a claim of measured hardware throughput gains.

## Historical implementation record

Recorded 3 November 2026. Phase 0 hardware, tools and the local model smoke test are verified. Phase 1 interface and gateway are verified. Phase 2 text conversation has started using Gemini, explicitly requested by the user as a temporary provider.

## Verified environment

| Item | Observed value |
|---|---|
| Operating system | Windows 11 Pro, build 10.0.26200 |
| Processor | Intel Core i7-13620H, 10 cores and 16 logical processors |
| RAM visible to Windows | Approximately 15.7 GiB |
| Dedicated graphics | NVIDIA GeForce RTX 3050 Laptop GPU, 6144 MiB VRAM |
| NVIDIA driver | 610.78, reported by nvidia-smi |
| Available disk at initial inspection | Approximately 91 GiB on C before downloads |
| Python selected | Existing Python 3.12.10 |
| Other Python installation | Python 3.14 is the default; not changed |
| Node and npm | Node 24.17.0 and npm 11.13.0 |
| Git | 2.54.0.windows.1 |
| Camera | Integrated Camera enumerated with OK status |
| Audio | Microphone Array and Realtek speakers enumerated with OK status |

Device enumeration does not prove browser permission, image quality or audio quality. These remain to be tested during their implementation phases. GPU VRAM comes from nvidia-smi because the general Windows adapter query can truncate memory values.

## Phase 0 progress

- [x] Record hardware and existing development tools.
- [x] Create an isolated backend environment with Python 3.12.
- [x] Add ignore rules for private runtime data, environments and installers.
- [x] Prepare a repeatable local inference smoke test.
- [x] Install and verify local Ollama runtime: version 0.40.14; signed installer verified; loopback API and local-only mode confirmed.
- [x] Download and verify qwen2.5:1.5b, Q4_K_M, Apache-2.0; digest recorded in local evidence.
- [x] Run two local inference requests and verify GPU allocation; first request 48.371 seconds and second request 0.356 seconds.

The installer download was interrupted and no Ollama executable was installed. Its partial file remains under ignored .setup/. A local-only configuration was prepared before the deferral. No model, camera or microphone was activated.

## Phase 1 completed work

- [x] React and TypeScript interface using the existing dark cyan design direction.
- [x] FastAPI backend with minimal health and authenticated capability reporting.
- [x] Local-only development proxy with server-side credential injection and browser-origin checks.
- [x] Real message request path with an honest model-setup-required response.
- [x] Connection polling, measured round-trip display, clear conversation and cancellable requests.
- [x] Mobile layout, reduced motion and visible keyboard focus.
- [x] Reproducible dependency records and a local startup helper.

## Verification evidence

Commands were executed against this workspace on the recorded Windows device:

| Check | Result |
|---|---|
| Backend pytest suite | 12 passed: authentication, origin rejection, missing credential, input limits, deferred inference and no execution route |
| Frontend production build | Passed TypeScript and Vite build |
| Frontend lint | Passed without findings |
| Edge browser tests | 4 passed: connected send and clear, offline state, proxy origin protection and responsive layouts |
| Visual review | Desktop at 1440 px and mobile at 390 px inspected; no horizontal overflow |

The backend test dependencies emit a Starlette deprecation warning about its httpx-based test client. The tests pass; migrate that test adapter when updating dependencies. Browser runner environment colour warnings do not affect results. The two local services were exercised live on 127.0.0.1 ports 8000 and 5173. No inference quality or model latency result is claimed.

## Starting assumptions

Use the existing laptop and no paid services. Initial language is English. Initial app mappings will use a small explicit allowlist during Phase 2. University deadline, study requirements, weekly time budget and optional features remain open decisions; they do not block the foundation.

## Gemini text integration

The user supplied a Gemini credential and authorized its use while Ollama is deferred. The key is stored in ignored backend/.env, not browser assets or source control. The model list was checked with the supplied key. Older 2.5 Flash models rejected generation for this account; gemini-3.1-flash-lite-preview returned a successful test response and is the configured temporary model.

The backend sends text and bounded recent conversation to Google. The interface displays cloud processing, provider and model, with camera and microphone remaining off. No automatic browsing, file access, computer actions or persistent memory is implemented. The local-only Ollama configuration is unchanged and unused.

Verification after integration: 22 backend tests passed; five Edge browser tests passed; frontend build and lint passed. Browser tests mock generation for reproducibility and do not spend live quota. A separate live call through the actual frontend proxy and backend returned HTTP 200 and the requested short reply in approximately 2.09 seconds. This is one smoke test, not a general latency benchmark. The earlier Phase 1 results above remain historical evidence.

The development guard allows one active generation and 50 attempts per UTC day per process, with no automatic retry or alternate-model fallback. It resets on restart. No account billing settings were changed or verified. The selected model is a preview and may need replacement. Official request and pricing references: https://ai.google.dev/api/generate-content and https://ai.google.dev/gemini-api/docs/pricing.

## UI reference review and redesign

All seven supplied UI reference images were visually inspected, and the original HTML prototype was rendered for review. The active React interface now follows their full-screen assistant layout: a particle globe, orbital rings, a holographic floor, top sensor indicators, concise central captions and slide-out history and settings. The decorative continent outlines originate from the supplied prototype and are not geographical data for navigation.

The globe is drawn locally with Canvas 2D, capped at 30 animation frames per second and paused when the page is hidden. The ambient-motion control and system reduced-motion preference stop animation. Processing is purple, standby blue and an available text reply amber. Amber means reply ready; it does not imply speech playback. Camera and microphone remain inactive. Their information controls do not request permissions. Suggested prompts fill the text field without sending automatically.

History, clearing, settings, cloud disclosures and Gemini conversation remain functional. The seven browser tests cover conversation context, history clearing, settings, inactive sensors, pending request cancellation, quota failures, offline behaviour, origin protection and viewport fit. Build and lint passed. Desktop, laptop and phone screenshots were reviewed. No backend behaviour or cloud permissions were expanded by this visual redesign.

## Next development gate

Continue Phase 2 with approved action definitions and explicit app mappings. After the user installs Ollama, run the local model smoke test and add a local provider behind the same gateway. Camera analysis, memory, voice and actual computer actions remain unimplemented. No automatic switch between cloud and local processing is enabled.

## Current increment original prototype port and first desktop action

Viewport follow-up: the stage now fills the actual visible viewport with no fixed minimum page height. The globe scales to available space, phone landscape uses a split layout, and short narrow viewports prioritize text controls. VisualViewport resize handling supports shrinking space when an on-screen keyboard opens. Long replies and drawer content scroll internally. Ten browser tests passed, including ten desktop, tablet, phone, landscape and short-height sizes, no document overflow, reachable input/disclosure and a long mobile reply. Actual physical-device keyboard behaviour still needs a device check.

This update supersedes the earlier simplified Canvas globe and the statement above that all desktop actions are unimplemented. The original HTML prototype's Three.js scene construction and GLSL shaders have been ported into a local ES module with a typed React boundary. Its particles, glass shell, atmosphere, inner core, orbital trails and floor are preserved. A local Canvas HUD provides rings and decorative state activity; it is not presented as a microphone signal. The Sora and JetBrains Mono fonts are bundled locally. GPU resources, resizing, visibility and reduced motion have explicit lifecycle handling.

The wake screen and Intro control operate only the visual lifecycle. React owns history, settings, captions, connection data and Gemini requests. The source's sample events, weather, scripted replies, fake detections and microphone auto-start were not imported. Suggested prompt seeds were removed. Missing services are shown as unavailable rather than filled with demo values.

Phase 2 now includes real app discovery from the local ORACLE_ALLOWED_APPS setting, a protected Applications endpoint, expiring proposals, cancellation and one-use confirmation. Exact open commands route to the local service before Gemini. The live machine returned notepad and calc from its configured executable names. Application presence is checked before display and again before execution; program paths and arguments cannot be supplied through chat. The confirmation map is locked against concurrent replay. No real application was launched during automated verification; process launchers are stubbed in tests.

Verification: 39 backend tests passed, including unsupported paths and commands, proposal-only behaviour, cancellation, expiry, launch failure, concurrent replay, route authorization and website target validation. Nine browser tests passed, including a real WebGL startup, API-supplied application records, separate launch confirmation, conversation, active-state cancellation, unavailable sensors and desktop/phone layouts. Build and lint passed. Screenshots were inspected against the supplied references. Three.js is split into cached build chunks; credentials remain outside browser assets.

This is a Phase 2 increment, not completion of the whole roadmap. Confirmed website opening now uses the same local proposal flow for an explicit HTTP or HTTPS URL, preserving case and rejecting embedded credentials, invalid ports, control characters and unsupported schemes. Automated browser-launch tests use a stub. Broader natural-language tool selection, streamed replies, file search, productivity records and later sensor features still need implementation and evaluation. Ollama installation remains deferred to the user.

## Prototype interaction refinements

The React UI retains the original Three.js scene and now adds pointer-based globe rotation and click-to-type, keyboard shortcuts that do not intercept typed text, drawer entry transitions and completed-reply entrance animation. Copy uses the actual returned reply. Motion, large captions and captions-only preferences persist in local browser storage; conversation text is not stored by this preference path. Captions-only mode hides and stops the continuous visualizer animation. Native modal focus and Escape dismissal remain intact.

Verification: frontend build and lint passed; 13 browser tests cover the existing workflows plus actual globe image changes during dragging, click focus, preference persistence, text editing shortcuts, captions-only visibility and copying the returned reply. No microphone, camera, speech playback or synthetic operational data was introduced. Suggested future additions remain dependent on their real services: streamed answer rendering, actual microphone-level visualization and user-selected camera overlays.

## Ollama installation and local model verification

Ollama 0.40.14 was installed from the official signed Windows installer after the user authorized installation. The signature was valid and the publisher was Ollama Inc. The API responds on 127.0.0.1:11434; server logs confirm cloud features disabled and CUDA detection of the RTX 3050. No account sign-in or cloud key was used.

The qwen2.5:1.5b model downloaded successfully and its SHA-256 layers were verified by Ollama. The model metadata identifies Q4_K_M quantization and an Apache-2.0 license. The model digest and detailed results are in ignored data/readiness/ollama_installation.json and local_model_benchmark.json. CLI reporting showed 100 percent GPU execution with a 2048-token context. These allocation readings are not peak memory measurements.

The first fixed nonpersonal prompt took 48.371 seconds, including 22.529 seconds of reported model loading and initial runtime warmup. The second request took 0.356 seconds and reported 97.95 generated tokens per second. Both returned a completed answer. This is a two-request readiness smoke test, not a model quality evaluation or a general speed guarantee. The small model is a baseline and should be evaluated before selecting it as the main assistant model.

Gemini remains the active ORACLE provider. Ollama has not been silently selected or installed as an automatic fallback. Integration and an explicit provider control are separate development work. The temporary installer remains in ignored .setup because automatic approval review blocked its removal without a detailed reason.


### UI refinement: native-inspired glass styling

Removed the replay Intro button. Added a grouped glass toolbar, 44px touch controls, rounded composer, platform system typography, softer panel surfaces, and accessible CSS settings switches using the existing checkbox inputs. Retained real chat, history, copy, preferences, and confirmed application actions; no demonstration records added. Build and lint passed; all 13 browser tests passed, including ten viewport sizes and long mobile replies. Suggested next refinements: reduce globe emphasis while reading replies and introduce mobile bottom sheets. No additional Ollama download was started.


### Direct workspace and responsive motion refinement

Removed the startup gate and Wake button: the real workspace appears immediately. Conversation content dims the decorative globe; active requests have a subtle processing pulse. Mobile history/settings/applications use native-dialog bottom sheets with internal scrolling. Ambient-motion and system reduced-motion preferences disable these animations. Application discovery errors appear inside the application panel. Build and lint passed; all 13 browser checks passed, including direct startup, keyboard focus, persistent preferences, confirmed actions, and viewport layouts.


### Automatic wake animation

Added a non-blocking 1.3-second entrance: soft glow, eased globe formation and small orbital settling, staggered toolbar/composer arrival, then subtle idle glow. Session storage prevents replay on reload within the same tab; tab visibility restoration produces only a brief glow. Input remains usable during entrance and immediately cancels its own decorative movement on focus. Existing motion controls and system reduced-motion preference suppress movement. Build/lint and 13 existing browser tests passed; an additional startup/reload/input test passed.


### Jarvis keyword wake

Supersedes automatic startup animation: the full wake sequence now runs after browser speech recognition detects the whole word Jarvis. An explicit enable control explains that browser recognition may use provider servers; support is detected at runtime. No automatic microphone start, recording storage, or transcript forwarding to Gemini. Recognition stops after matching, manual stop, tab hiding, or unmount; errors and unsupported browsers retain text access. This is browser speech recognition, not offline keyword detection. Build/lint and 14 existing checks passed; an additional simulated recognition test verified explicit enable, rejection of unrelated speech, keyword triggering, and recognition cleanup. Physical microphone recognition remains a manual check.


### Globe-focused home and on-demand conversation

Removed the permanent home composer and voice setup text. Type message, globe click, and Ctrl/Cmd K open and focus conversation; History remains available from the toolbar. The composer, cloud disclosure, full transcript, copy, stop, and clear controls live in the conversation panel. Home shows only a bounded 220-character preview and Read conversation entry. Voice-wake setup and provider disclosure moved into Settings; only active listening gets a home indicator/Stop control. Desktop uses a side panel and mobile a bottom sheet with internally scrolling transcript and fixed composer. Action proposals reveal the home confirmation card and select a steady amber globe state; reading replies slows decorative motion and offline colors are subdued. Typing does not launch actions without confirmation. Browser suite revised for the on-demand panel layout.


### Prototype behaviour inspection and implementation alignment

Opened the source HTML in the browser and inspected startup, home, History, and Settings. A temporary inspection copy bypassed microphone/sound activation so the prototype could be inspected without granting sensor permissions; the source was preserved. Matched separate circular toolbar controls, globe vertical composition, quiet status text, caption word arrival, a nonmodal History side drawer, compact desktop Settings tray, and mobile sheets. Outside taps and Escape close panels; toolbar buttons reflect expansion state. Added Space for globe interaction, V for camera, C for captions, and R for motion, while text editing is protected.

The globe now starts browser speech recognition, finishes capture on a second tap, and interrupts an active request. Actual recognized text uses the same bounded chat endpoint as typing. Unsupported recognition falls back to the conversation panel. Raw audio is not sent to Gemini by this app; browser recognition may process it with its provider. Jarvis keyword wake remains opt-in.

Camera panel requires explicit Start camera and offers live preview, local photo capture, save, discard, and stop. Camera tracks stop on panel unmount, hidden tab, capture, and late permission resolution after closing. No camera image is uploaded or analysed. Tests use synthetic recognition and synthetic camera streams; physical device checks remain manual.

Deliberately retained earlier user requirements: no replay Intro control, no fabricated schedule/weather/notifications, real backend actions still require confirmation, responsive full-viewport layout. Prototype audio playback, push-to-talk hold mode, face/object recognition, agenda/weather integrations and simulated speaking states are not represented as implemented.

Validation: build and lint passed without warnings. Twelve browser checks cover panel layout/focus, full conversation/context/copy/clear, rotation, preferences, confirmed actions, cancellation, seven viewport sizes, keyword wake, offline/auth, recognized voice submission, synthetic camera capture, and late camera cleanup. Escape stops microphone recognition as well as closing panels.


### Prototype sleep mode

ORACLE now starts asleep with a dim visualizer and ASLEEP caption/status. Globe tap wakes without activating a microphone; enabled Jarvis recognition also triggers wake. The sleep prompt mentions Jarvis only while recognition is actually listening. Typing and preparing a confirmed application action wake the assistant. Sleep is available from the home screen and Settings; it aborts current waiting, stops command recognition, closes panels (releasing camera), and cancels pending application proposals while preserving conversation history. Opt-in wake detection is retained if already active. No automatic background microphone activation or simulated audio levels.


### Full prototype audit and real feature implementation — 2026-11-04

The initial prototype UI and its audit document (PROTOTYPE_UI_AUDIT.md) were removed. Added persisted user timers/reminders/meeting links, queue/snooze/dismiss, Up Next, Open-Meteo selected-city weather, optional speech/cues/PTT, real RMS microphone activity, idle sleep, error retry/expiry UI, independent camera window, front/rear preference/focus capability checks, local file input, and actual local face/object models. The local visual-context command uses fresh detection output without a Gemini call.

Verified 39 backend tests; all 22 browser acceptance checks across full run plus a targeted viewport-overlap fix/retest; actual positive cat/face and empty-image inference; compiled-build detection/context checks; live weather endpoint smoke; clean lint and zero npm known vulnerabilities. Build passes with a documented lazy vision chunk size warning. A production-only TFJS split-bundle initialization failure was found and corrected by retaining registration-sensitive modules together in one on-demand bundle.

Physical sensor/audio checks, external calendar account sync and a closed-app/background wake/notification service remain explicit acceptance gaps. This is not represented as 100% production/hardware verification. No additional Ollama download was initiated.


### Deep sleep and reference visual fine-tuning

The asleep screen now uses the reference's boot/hold composition: normal toolbar, captions, chips and drawers hide; a dim scattered globe, atmospheric dust, ORACLE name and actual Wake control remain. Explicitly armed keyword recognition can still wake and has a visible Stop control. Resuming does not activate a sensor automatically. Deep sleep remains centered on short landscape viewports. Restored renderer opacity/particle dispersion and increased desktop globe radius/floor offset to the reference proportions; the earlier sleep implementation had multiplied opacity reductions until most depth disappeared. Reduced motion and hidden-tab pause remain supported.

Matched against supplied screenshots and the later local Jarvis Voice Interface (10).html source. This is ORACLE application sleep, not Windows power suspension. Scene-specific styles are in DeepSleep.css and do not replace panel/control styles.

Deep-sleep refinement validation: production build passed (existing lazy-vision size warning), lint clean, and all 24 foundation browser checks passed in one full run. Captured 1920×1080, 1920×911, 1366×768, 390×844, 320×568, 844×390 and 390×420 deep-sleep/awake layouts. Verified hidden normal controls, explicit resume, preserved display preferences and an enabled Jarvis listener resuming from deep sleep. Evidence snapshots: data/readiness/ui-audit/deep-sleep-desktop.png and deep-sleep-mobile.png.


### Phase 0/1 gate closure without Ollama

Completed the current non-Ollama readiness and Phase 1 technical acceptance. Rechecked actual Python/Node versions, disk, current provider and configured application discovery; inspected startup configuration/ignore rules; verified a fresh isolated gateway startup and unauthorized request rejection without touching the active development services. Backend: 39 passed; frontend: 26 passed; production build and lint passed; pip dependency consistency passed. The existing lazy-vision bundle size and Starlette TestClient deprecation warnings remain documented and are nonblocking for this foundation gate.

The phase plan, readiness checklist and root README now distinguish completed Phase 1 from partial later implementations and excluded local-provider work. Evidence: ignored `data/readiness/foundation-gate.json`. The next formal phase is Phase 2, using the current Gemini path until local-provider work is resumed. No new product features, Ollama downloads, physical sensor activation or live AI generation requests were added in this closure.
