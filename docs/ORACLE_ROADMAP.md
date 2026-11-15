# Oracle development roadmap

14 November 2026 · Oracle Central for Windows, Atlas, and Oracle Companion for Android

This roadmap reflects the current Windows working tree and the sibling Android project. **Implemented** means the relevant source or documented software path exists. **Partial** means implementation depends on configuration, has a known gap, or still needs an integrated check. The roadmap review did not run builds, tests, hardware scenarios, or deployments. Historical test results belong to the dated reports linked below.

## What has been developed

| Area | Implemented | Work still open |
| --- | --- | --- |
| Desktop experience | React/WebGL Presence orb, wake and dormant states, live captions, sensor indicators, workspace settings and diagnostics. | Check settings, cards and overlays together at normal and high Windows display scaling. Test caption and date placement while speaking and when returning to idle. |
| Conversations and live answers | FastAPI conversation paths, local Ollama and optional Gemini, streaming and reply preferences, and direct handling for time, weather, conversions, calculations and selected system questions. | Verify local time and short spoken replies across Windows and Android. Test typos, follow-ups, provider outages, cancellation and clear fallback. |
| Voice | Local speech transcription, TTS paths, wake-word and push-to-talk flows, and caption integration. | Run physical microphone/speaker checks for wake, silence, background noise, interruptions, and voice replies. |
| Camera and visual intelligence | Live face and object tracking, OCR/QR capture, product intelligence, approved image memories and capture folders. | Test real packaging and low light, track items through brief occlusion, and distinguish category recognition from a confirmed product match. |
| Identity and protocols | Face and voice enrollment paths, role controls, admin protocol, taught commands and command history. | Verify unknown and enrolled users, role boundaries, consent removal, permission checks and auditable outcomes. |
| Records and productivity | Notes, timers, tasks, reminders, image memory and durable storage with migrations. | Verify upgrades and restore on the active database. Confirm overdue reminder behavior after closing, restarting or waking the app. |
| Workspace and research | Google Calendar/Tasks connector, briefing and agenda, document extraction and cited local retrieval. | Verify current Google consent and real account behavior. Public OAuth verification and broad research-provider acceptance remain open in the project notes. |
| Atlas | Search, multilanguage place names, routing, stops, saved places and parking, foreground navigation and rerouting, GIS imports and filters, elevation and calendar-trip tools. | Field-check Sri Lankan searches and routes, low-accuracy recovery, permissions, provider coverage and mobile handoff. Offline operation needs separately provisioned datasets. |
| Android Companion | Windows pairing screen and gateway, Android client, chat and reply-mode paths, device controls and remote host support. Atlas and device-health patch files are also present in the Android project. | Verify which increments are in the installed build and work against current Central. Check fresh install and upgrade, QR pairing, voice turn, route handoff, remote reconnect and device revocation on a physical phone. |
| Performance and operations | Feature lazy loading, visibility-aware polling, reduced stale camera work, and diagnostic probes. Earlier reports record targeted validation. | Establish a current Windows runtime baseline, reproduce the build from a clean checkout and validate the supported Android build and installation path. |

The working tree contains modified and untracked source alongside generated outputs and a local database. The latest source, the committed revision, and the installed phone build are separate release inputs. Record all three when validating a feature.

## What to develop next

| Order | Deliverable | Work | Acceptance |
| --- | --- | --- | --- |
| 1 · P0 | Reproducible Central and Companion baseline | Inventory current changes and sibling patches. Identify the canonical Central gateway and Android build path, classify generated artifacts and runtime data, document versions and launch commands, and run backend tests, the frontend build and focused browser checks. | Another clean checkout can start Central and build a matched Companion APK. Checks and known failures are recorded against revisions. |
| 2 · P0 | Companion pairing, voice and reconnect | Validate and close gaps in Settings → Companion QR enrollment, Wi-Fi pairing, cross-network access, retry, revoke and voice reply. Show connection state and actionable errors on the phone. Validate which app controls and device-health fields Central actually exposes. | Fresh install and upgrade open on the test phone. One pairing survives app restart and a network switch. Each voice turn sends once and speaks one reply. Revoking the phone blocks its next authorized request. |
| 3 · P0 | Reliable desktop voice and answers | Measure speech-to-transcript, first reply text and first audible response for direct answers and AI requests. Exercise local time, weather, follow-ups, cancel, sleep and model unavailability. Fix the slowest measured stages first. | Local-time replies use the configured or requested locale. Cancellation suppresses stale text and audio. Record median and p95 latency on the target PC alongside provider/model and test conditions. |
| 4 · P1 | Atlas navigation and mobile handoff | Walk or ride a known local route. Exercise Locate Me, the route card, alternate starts, a missed turn, weak GPS, missing providers and a saved-place or route transfer to the phone. | Locate Me centers the map without opening an unrelated panel. Navigation pauses on stale fixes and recovers when accuracy returns. Handoff preserves destination and mode and reports failure clearly. |
| 5 · P1 | Camera, identity and protocol acceptance | Test OCR with labels, QR scanning, unknown objects and product matches, stable tracking and clear role labels. Exercise protocol cancellation, action confirmation, audit records and enrollment removal. | Labels stay readable and outside the face when space permits. Uncertain matches require confirmation. Privileged actions enforce permissions at execution and record their actual outcome. |
| 6 · P1 | Productivity and release readiness | Test reminder recovery, note and memory export/restore, Google account reconnect and sign-out, scaling and mobile layout, and Windows/Android packaging. Document local versus optional provider features. | A clean install can complete the supported Windows and Android flows. Records survive the documented upgrade and restore process. Provider failures leave local features usable. |

The first milestone is one repeatable cross-device session. Start Central, install the matched Android build, pair from the Windows QR, ask the time by voice, hear the reply on the phone, switch networks, reconnect, then revoke the phone. Use that session to decide which build and connection gaps to fix first.

### Existing Companion build baseline · 15 November 2026

- The Android project is in the adjacent `Oracle app` folder. It already has Jetpack Compose screens for onboarding, pairing, PC controls, system monitoring, Atlas, camera, records, and Google Workspace. Its package is `dev.oracle.companion`.
- For the Central pairing flow, start `run-system.bat` and use **Settings → Companion**. Central registers `backend/app/companion_settings.py`, which starts the listener using `backend/app/companion_gateway.py`. The Android project's README also describes an earlier standalone gateway. Use Central's integrated listener for this milestone.
- Build the existing app from `Oracle app` with JDK 21 and Android SDK 35 by running `./gradlew.bat :app:assembleDebug`. The Gradle output path is `app/build/outputs/apk/debug/app-debug.apk`. The separately named `Oracle_Companion_Debug.apk` already exists and its APK signature verified. Its manifest declares version `0.1.0` (code `1`) and minimum SDK 26. Record the APK hash and build source when testing, since the debug APKs can share the same version metadata.
- The initial staged rebuild hit an access-denied error on the default Gradle wrapper cache. With a workspace-owned cache, Gradle started its daemon but the client could not connect to it. ADB also could not start its daemon, so the installed phone build and physical-phone acceptance remain open.
- `backend/tests/test_companion_pairing.py` passed against temporary gateway state. It verifies that a QR pairing code is single-use, the credential survives a gateway restart and a change from LAN to remote transport, and a revoked credential is rejected. Physical network switching and Android voice playback still need a device run.
- Central's `npm run build` passed on the current working tree. Vite reported an oversized MapLibre chunk.

### Companion voice delivery

- Companion chat submissions now return the completed reply for the submitted message ID alongside the conversation history. Replaying a completed message returns the same reply, even if another turn has since completed. The existing history endpoint keeps its current response shape.
- The Android change is in `scripts/patches/companion-voice-reply.patch`. From the adjacent Android project's root, run `git apply ../Oracle/scripts/patches/companion-voice-reply.patch`. The patched client refreshes the connection and retries the same voice turn once after an I/O error. It uses the attached reply for speech and falls back to the history for older Central builds.
- Ten focused backend tests passed, and `git apply --check` passed against the Android source. The patch still needs to be applied in the Android project, built and exercised on a phone.

## What can be developed after the baseline

| Priority | Feature | First useful version | Dependency |
| --- | --- | --- | --- |
| P2 | Shared desktop and mobile conversations | Continue the same selected thread on either device and merge messages by stable ID when reconnecting. | Paired-device identity, thread storage and retry behavior. |
| P2 | Phone GPS for Atlas | Use current phone location for a trip on explicit request, showing fix age and accuracy. | Mobile handoff and a clear consent flow. |
| P2 | Background reminders and Windows tray | Launch at sign-in by preference, show timer and reminder notifications while the window is closed and deep-link back to Oracle. | Runtime lifecycle and reminder recovery. |
| P2 | Searchable local knowledge | Index approved documents by folder, answer with page citations and re-index changed files. | Reliable ingestion, retrieval checks and local resource budgets. |
| P2 | Saved trip continuity | Resume an itinerary on either device, with a small local cache of the itinerary and selected map context. | Atlas handoff, provider support and storage limits. |
| P2 | Sinhala and Tamil interaction | Start with place names and common assistant commands, then evaluate transcription quality with local speakers. | Real speech samples and measurable accuracy. |
| P3 | Offline Atlas regions and background geofences | Pilot one Sri Lankan region, with explicit download size, update controls and battery testing. | Map data licensing, offline routing, storage and Android background permission behavior. |
| P3 | Desktop pet and proactive assistance | Optional tray companion for timers, reminders and device status, with quiet hours. | Stable Windows background runtime and measured resource use. |
| P3 | Multi-PC Companion and reusable workflows | Select one paired PC at a time and run a small set of permission-scoped workflows with previews and outcomes. | Device-specific identity and reliable protocol execution. |

## Project references

- [Development status and dated acceptance evidence](DEVELOPMENT_STATUS.md)
- [Original requirements inventory](02-requirements/COMPLETE_FEATURE_LIST.md)
- [Atlas implementation and provider configuration](MAPS_AND_LOCATION_INTELLIGENCE.md)
- [Performance findings and measurement plan](SYSTEM_PERFORMANCE_AUDIT.md)
- [Camera audit](CAMERA_AUDIT.md)
- [Google verification status](GOOGLE_VERIFICATION_SUBMISSION.md)
