# Oracle system performance audit

12 November 2026

The audit covers the React/WebGL desktop interface, the local FastAPI gateway, camera and voice processing, Atlas, external providers, and durable records. Changes were made in the existing checkout alongside work already in progress.

## Audit plan and acceptance checks

| Phase | Reproduction and measurements | Pass condition |
| --- | --- | --- |
| 1. Startup and packaging | Run three cold and three warm starts from the production build. Measure time to interactive controls, compressed entry assets, peak working set, and first-open latency for Camera, Atlas, Records, and Diagnostics. Check the Vite and FastAPI entry points. | Entry assets shrink, hashed assets reuse the browser cache, and packaged features open without missing assets or startup exceptions. |
| 2. Idle and lifecycle | Capture 60 seconds each in Ready, Dormant, and a hidden window. Compare CPU, GPU, working set, render activity, and request count. Wake Oracle and check camera, microphone, weather, timers, and reminders against the chosen settings. | Hidden UI timers and visibility-sensitive polls stop, overdue reminders reconcile on return, and enabled wake listening still works. |
| 3. Active workloads | Run camera tracking, product scanning, voice-to-command, Ollama chat, Atlas pan/search, and Records individually. Repeat with camera and voice active together, then with the map open. Record frame times and median and p95 interaction latency for each scripted sequence. | Controls remain responsive, stale results do not replace newer selections, and overload drops live frames while current recognition recovers. |
| 4. Storage and connectivity | Exercise reminders with past and future records, then repeat under SQLite and PostgreSQL. Start with providers offline, reconnect them, and exercise malformed responses, slow requests, and retry/cancel paths. | No duplicate writes or stale pending results. Startup and offline local features work when optional providers are unavailable. |
| 5. Regression and sign-off | Run the production build, the full backend suite and Playwright, then repeat the hardware scenarios with the same devices, models, data, and display settings. | Compare before/after measurements under identical conditions and record all skipped tests, observed failures, and open issues. |

## Findings and changes

| Area | Finding | Change |
| --- | --- | --- |
| Startup | Camera, product scanning, records, and diagnostics entered the initial bundle even when closed. | Split them into feature chunks loaded when opened. |
| Packaged frontend | FastAPI served fingerprinted JavaScript and CSS with `no-store` and lacked a mount for the Atlas basemap previews. | Cache successful hashed assets as immutable and serve the packaged Atlas directory. |
| Conversation | A one-second clock ran in the closed conversation panel. Focus timers counted callbacks and could drift when the browser throttled them. | Tick the action clock only when needed. Calculate countdowns from an expiry time and schedule completion separately from the visible countdown. |
| Reminders | A hidden poll could still make requests. The alert widget fetched the entire task list and filtered it in the browser. | Suspend hidden polling and refresh on return. Query due tasks with the existing due-date index and skip equivalent UI updates. |
| Presence and profiles | Clocks updated while hidden, profile refreshes could overlap, and unchanged profile data triggered re-renders. | Suspend clock updates while hidden, bound profile refreshes, and notify consumers only for changes. |
| Settings and weather | A closed settings panel listened for frame events and fetched the memory list. Weather refreshed every 30 seconds with the cache disabled. | Subscribe only while the Faces tab is open. Use the existing five-minute weather cache and suspend hidden requests. |
| Camera | The QR fallback could repeatedly allocate a canvas and send frames. QR uploads inherited the small JSON-body limit. Saturated live detection could queue old frames. | Reuse the QR canvas and limit the fallback to one request per second. Apply the authenticated image limit to QR uploads. Reject excess live inference with HTTP 429 and keep the last valid tracking result until the normal expiry. |
| Gateway TLS | The process inherited an inaccessible Windows TLS key-log path. Atlas failed during startup, and other provider clients used the same key-log-sensitive context construction. | Build certificate-verifying contexts without opening a key log. Keep the existing system trust or CA configuration for each client. Skip provider client work for Atlas configuration-only requests. |

## Measurements and remaining work

- Baseline production build reported 172.44 kB gzip for the main JavaScript entry and 36.31 kB gzip for its CSS. The final verified build reported 145.69 kB and 29.08 kB respectively, about 16% and 20% smaller. Including the unchanged startup vendor and Three.js preloads, these entry assets together decreased from about 390 kB to 356 kB gzip. Vite bundle sizes measure transfer size rather than startup time or working memory.
- The production build, 20 targeted backend tests, four frontend logic tests, and direct smoke checks for TLS, Atlas route registration, the SQLite due-only query, and QR decoding above 32 kB passed.
- Run the runtime checks above on the target Windows machine. Local socket restrictions blocked the Python integration runner, and Edge exited during Playwright launch. Physical device, concurrent workload, PostgreSQL, external provider and end-to-end measurements remain open.
- The Atlas module is still large when first opened. Profile its download, parse, map initialization, and tile requests before changing map dependencies or first-use behavior.
- The follow-up replaced simulated diagnostic readings. Ollama reports measured probe latency and whether its configured model is listed. Gemini is shown as configured and unverified because this check sends no cloud request. Storage reports its actual dialect, migration, query timing and task and note counts. Camera and microphone show available device readings and report unavailable or skipped checks in the summary. Camera tracks are released when the check closes.
- The follow-up production build, 20 targeted backend tests and a direct SQLite diagnostic check passed. The browser acceptance retry still stopped at Edge launch. CPU, GPU, RAM and interaction latency still require measurements on the target machine.

