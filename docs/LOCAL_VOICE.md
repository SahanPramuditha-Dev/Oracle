# Phase 6 local voice

## Implemented path

The browser records one explicitly started utterance and sends it to authenticated FastAPI. Faster-whisper uses the prepared tiny English model on CPU with int8 compute, two CPU threads and one worker. Audio decoding, silence handling and transcription happen locally. The resulting transcript opens in the message field for review; **Send** is a separate action. Conversation text can then use the configured Gemini provider. Desktop actions still require their normal confirmation.

Windows SAPI synthesizes replies into temporary WAV files, which are returned to the browser and removed from the backend temporary folder. The browser plays the WAV only when requested or when Read replies aloud is enabled. Stop/Escape aborts waiting, pauses playback, revokes its object URL and prevents a late response from starting new audio. Synthesis does not play through the backend's speakers.

Local voice is the default. Settings → **Local voice processing** can explicitly switch to browser speech. There is no automatic cloud speech fallback. Browser keyword wake remains a separate opt-in feature that may process audio through its browser provider; it is not an offline wake-word engine.

## Setup

```powershell
.\backend\.venv\Scripts\python.exe scripts\prepare_voice_model.py
```

This explicitly downloads the public `Systran/faster-whisper-tiny.en` speech model (about 78 MB of model/tokenizer data), pins the resolved repository revision in a local manifest and records file hashes under ignored `models/whisper-tiny.en`. Runtime inference uses local files only and never downloads a missing model. No Ollama installer, model, service, benchmark or provider change is involved. Synthesis uses the installed Windows speech voice; no new voice download is needed.

## Use and limits

- Wake the interface, then tap the microphone/globe or use Push to talk. Permission denial leaves typing available.
- Finish recording to transcribe; review the draft and select Send. No clear speech produces an honest message rather than an invented command.
- Record at most 45 seconds/4 MiB. The client finishes at 44 seconds to leave encoding margin. The server independently bounds decoded samples and rejects video streams or invalid audio.
- Enable Read replies aloud for local WAV playback. At most the first 2,000 characters are synthesized per request; the full reply remains visible.
- Stop, sleep, hidden-page cleanup, mode changes and unmount release capture resources and cancel pending client work. A local inference or synthesis already running can finish in the backend; its late output is ignored after cancellation.
- Raw microphone audio is not written to the records database or sent to Gemini. Transcription is in memory. Explicit test fixtures are synthetic WAV files in ignored readiness data, not user recordings.
- Tiny English recognition is a baseline, not an accuracy guarantee. Review transcripts. Trailing sentence punctuation and spacing variants such as “note pad” are accepted only when they still resolve to an existing approved application ID. Spoken timer numbers one through ten are supported.

## Acceptance and remaining checks

Real local speech synthesis/transcription tests generate “Open notepad,” transcribe it and verify the resulting backend request proposes the mapped action without launching it. Network-blocked Python tests pass with prepared local assets. Browser tests verify review-before-send and cancellation of a delayed local speech response. These are synthetic-audio tests, not a human microphone or speaker check. Final verification: 84 backend tests and 38 browser tests passed, along with frontend build/lint, dependency checks and the read-only integration gate.

The user authorized a physical camera preview check: it reported 1280×720, ready state 4 and active playback, then was explicitly stopped. Continuous focus was unavailable. No physical camera frame was captured or saved. Printed-label OCR/memory acceptance remains open. The user explicitly chose to leave the human microphone test pending; no microphone activation was performed for that check. Human speech intelligibility and audible playback acceptance therefore remain open.

## Phase 7 groundwork

Run `scripts/check_integration.py` using the backend Python environment while the gateway is running. It checks health, authorization, active PostgreSQL, image-reading/memory availability and local voice readiness, and writes an ignored readiness report. It does not activate sensors, generate cloud replies, launch applications or use Ollama. Full integrated phase sign-off still requires the outstanding physical journeys and resource/offline checks.

References: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Windows speech file output](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee125549%28v%3Dvs.85%29).
