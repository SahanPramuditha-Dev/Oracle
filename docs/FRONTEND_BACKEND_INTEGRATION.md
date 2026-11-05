# Frontend/backend integration — 5 November 2026

The replacement Presence frontend now calls the existing FastAPI backend. Saved records live in PostgreSQL; the current conversation and unsaved drafts remain page-local.

| Area | Connected behavior |
|---|---|
| Chat | `/api/v1/chat`, bounded recent history, actual provider status, cancellation and errors. Desktop action proposals require explicit confirmation through the actions API. |
| Voice | Local backend transcription and speech synthesis. Push-to-talk returns a reviewable draft; sending is separate. Closing/stopping cancels recording, transcription requests and playback. |
| Camera | Explicit preview, backend detection/identification, snapshot to conversation and image reader. Capture/close stops camera tracks. |
| Image reading | Backend OCR/QR, editable corrected text, crop selection, explicit save as note or image memory. Decoded QR content is displayed as text. |
| Notes | Create, search, edit and delete through `/api/v1/notes`. Failed saves retain drafts. |
| Reminders/timers | Create, list, dismiss/delete and snooze through `/api/v1/tasks`. Due alerts use backend task state while the application is open. |
| Memories | Search, display stored images, edit descriptions and delete through `/api/v1/memories`. Saving an image is explicit. |

Open **Workspace** in the header for notes, reminders and memories. Open conversation with the chat control or C; use its attachment and microphone controls for images and push-to-talk.

## Session and request behavior

The browser establishes an HttpOnly, SameSite=Strict session through `/api/v1/auth/session`; the server does not return its raw API token to JavaScript. Vite's loopback API proxy can authenticate approved local frontend requests with the server-side token file. Existing bearer authentication remains available to local tools. Origin checks and upload limits remain enforced. Mutations are not automatically replayed after errors.

Requests have timeouts and cancellation. Camera, audio, image preview URLs and late asynchronous results are cleaned up on closure. UI status reports backend results and errors rather than inventing stored records or model availability.

## Running and checking

Use the existing backend environment and PostgreSQL configuration. Start the frontend with `npm run dev` from `frontend/`; Vite uses port 5173 and proxies `/api` to the backend on port 8000. No new model installation is required by this integration.

Build: `npm run build`. Browser checks: `npm run test:e2e` with both services running and Microsoft Edge installed. Tests use unique temporary record names, and successful CRUD checks remove their records. Interrupted tests may leave their named test records behind.

Validation: 97 backend tests passed with the PostgreSQL test URL configured; all 8 browser integration tests passed; the production build passed (with the existing large-bundle advisory). Browser coverage includes actual record persistence, real OCR and fixture-based transcription, plus controlled chat/action responses, synthetic camera streams and delayed speech cancellation. These are bounded integration checks, not acceptance of every planned feature or physical microphone/speaker quality.

## Boundaries

Follow-up acceptance on 5 November: all 11 browser tests passed in one run, including sleep/pending-reply cancellation with conversation preserved, camera-permission denial with file/records fallback, and recovery after a backend 503. Production build passed; the live integration script passed all ten readiness gates. These checks did not activate physical sensors or close the hardware gates below.

Reminders do not yet provide an operating-system background scheduler when the app is closed. Wake/VAD runs only while its conversation interface is open. The existing initialization sequence is separate UI work and is skipped by the integration tests; its device checks are not required to use Workspace. No Ollama/model downloads were performed for this integration. Full-product scope remains tracked in `FULL_SCOPE_AUDIT.md`.
