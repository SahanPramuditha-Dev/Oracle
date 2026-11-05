# ORACLE development readiness

Updated 5 November 2026. Phases 0–9 have active implementation evidence: PostgreSQL records, the Presence frontend, local vision/voice software, research retrieval and the bounded Google Workspace connector. Physical camera/printed-label and microphone/speaker checks remain open. See [development phases](DEVELOPMENT_PHASES.md) for the authoritative scope and [development status](DEVELOPMENT_STATUS.md) for dated evidence. Earlier checklist entries below describe the foundation gate and should not be read as the current product inventory.

## Decisions needed before implementation

| Item | Proposed starting position | Status |
|---|---|---|
| Target machine | Existing Windows laptop, no new hardware | i7-13620H, approximately 16 GB RAM, RTX 3050 with 6 GB VRAM |
| Budget | No paid APIs, hosting, subscriptions or additional hardware | User requested |
| Interface | Local browser UI; laptop first | Implemented and checked on desktop/phone-sized viewports |
| First input | Text first | Text foundation complete; later sensor work is not required for this gate |
| Language | English first; evaluate other languages separately | Working baseline |
| Initial actions | Explicit configured apps and websites | Protected discovery returns configured apps; confirmed Notepad window launch verified |
| Persistent data | No retained raw media; later approved notes/memories | Notes/tasks use backend PostgreSQL; preferences are browser-local and transcript is page-local |
| Model | Current user-authorized Gemini path | Ollama/local-provider work excluded from this gate |
| University work | Research question, deadline, ethics and assessment | To confirm |

Unresolved optional features do not block the first local foundation. Hardware and runtime compatibility must be known before model installation and performance promises.

## Environment checklist

- [x] Record Windows version, processor, installed RAM and available disk.
- [x] Record GPU and dedicated memory if present; do not assume a GPU is required or available.
- [x] Confirm existing Git, Python, Node and package-manager versions without replacing working tools unnecessarily.
- [x] Verify selected Python 3.12.10 and Node 24.17.0; backend dependency consistency and frontend compilation pass.
- [x] Record camera/microphone/output device enumeration. Physical sensor permission and quality tests belong to their later implementation phases.
- [x] Record current free disk (approximately 71.2 GiB) and verify installed foundation dependencies. No model download allowance is consumed by this gate check.
- [x] Verify the current backend environment, frontend build, lint and browser checks; no further package installation is needed for Phase 1.
- [ ] Deferred / excluded: Ollama installation, model download/benchmark and local-provider integration. Earlier measurements remain historical evidence, not a requirement to repeat now.
- [x] Keep models and runtime data outside source control through ignore rules.

Initial downloads need internet. Later offline tests must include a restart so that missing cached assets are discovered.

## Proposed repository layout

The backend, frontend and runtime folders exist. The nested layout below remains a target structure for later refactoring; not every proposed subfolder is needed for Phase 1.

```text
Oracle/
  backend/
    app/
      api/
      assistant/
      tools/
      desktop/
      productivity/
      vision/
      memory/
      voice/
    tests/
    pyproject.toml
    .env.example
  frontend/
    src/
      components/
      features/
      services/
      styles/
    package.json
    package-lock.json
  data/                 private runtime data, ignored by Git
  docs/                 active planning and start guides
  archive/              recovery documents, not application input
  .gitignore
  README.md             actual installation and startup instructions
```

Use one Python dependency declaration and a reproducible version lock or equivalent record. Keep experimental training tools out of the initial runtime environment. Preserve the existing UI prototype and images as references.

## Initial configuration

Record backend and frontend loopback addresses, allowed browser origins, authentication configuration, local model identifier, timeouts, permitted app mappings, allowed file roots, upload limits, runtime data path and timezone. User-facing times initially use Asia/Colombo; stored due times should retain an unambiguous timestamp and timezone context.

No external API credentials are needed for the initial foundation. Keep .env and any local authentication secrets out of Git and client bundles. Example files contain placeholders, never real credentials.

## Data and lifecycle baseline

Start with sessions, optional stored messages, approved notes or memories, linked approved assets, tasks, reminder due times and minimal action outcomes. Do not design every future entity before using the first record. Use source IDs and timestamps so saved facts have evidence. A deletion must cover the record, linked photo and applicable index entry. Do not retain camera frames or microphone recordings by default.

For the first demo prepare a few nonpersonal labels, QR codes and sample notes. Use files inside a dedicated sample folder to exercise search and opening. Do not rely on face enrollment or participant recordings for basic development.

## First development backlog

| Task | Ready when | Finished when |
|---|---|---|
| DEV01 Environment baseline | Machine accessible | Actual specs and tool versions recorded |
| DEV02 Local inference check | Compatible runtime and selected model | One prompt works; latency and memory recorded |
| DEV03 Backend health | Environment prepared | Real endpoint returns health and handles failures |
| DEV04 Interface shell | Frontend environment prepared | Chat field, status and stop control render |
| DEV05 Authorized connection | Backend and shell exist | Allowed client works; unauthorized requests fail |
| DEV06 Text response | Local model adapter connected | Request returns answer or actionable error |
| DEV07 First app action | Exact approved target configured | Valid request opens it; invalid target is rejected |

DEV01 and DEV03 to DEV07 are complete for the authorized provider paths. DEV02 is satisfied by the available local-provider benchmark but remains optional for a Gemini-only setup. A real Notepad window launch was verified after UI confirmation. Phase 3 and 3.1 add durable PostgreSQL records and passed a real backend restart demonstration. See the current phase/status records for validation and limits.

## Required records while developing

Maintain a short root README, tested dependency versions, a decision log in SCOPE.md, meaningful test results next to the relevant code, and known limitations. For each phase record date, build or commit, device, procedure and actual result. Create detailed API schemas, migrations and formal test matrices only as those components are implemented.

## Current development boundary

The UI/gateway foundation, provider-based text/action path, PostgreSQL records, vision/voice software, research retrieval and Google Workspace connection are implemented. Physical printed-label and local voice hardware acceptance remain open. Approved image-memory software has connected fixture coverage. Ollama is optional and is not required for a Gemini-only development setup.
