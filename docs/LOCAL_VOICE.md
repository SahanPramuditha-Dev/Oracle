# Phase 6 local voice

## Implemented path

The browser records one explicitly started utterance and sends it to authenticated FastAPI. Faster-whisper uses a lazily loaded local model with configurable device, compute type, language, and model path. Audio is decoded to mono 16 kHz. Clean audio is the default baseline; optional Wiener/high-pass preprocessing can be enabled per request or with `ORACLE_VOICE_PREPROCESS=true`. The resulting transcript opens in the message field for review; **Send** is a separate action. Conversation text can then use the configured Gemini provider. Desktop actions still require their normal confirmation.

Local Kokoro synthesizes replies when its model assets are available. Windows SAPI provides the fallback and honors the speech speed setting. The browser plays the resulting WAV when requested or when Read replies aloud is enabled. Stop/Escape cancels pending playback. In automatic listening modes, Oracle ignores utterances that start during playback and accepts new speech as soon as playback ends or is stopped.

Hands-free and wake modes use Silero in the browser to detect speech and the local backend to transcribe it. Wake mode accepts “Hey Oracle” at the start of the transcript.

## Setup

### Voice configuration

Optional backend environment variables:

- `ORACLE_VOICE_MODEL`: local Faster-Whisper model directory. Oracle prefers `models/whisper-small` when installed and falls back to `models/whisper-tiny.en` for English. Sinhala and automatic language detection require a multilingual model.
- `ORACLE_VOICE_LANGUAGE`: `en`, `si`, or `auto`; defaults to `en`.
- `ORACLE_VOICE_DEVICE`: `auto`, `cpu`, or `cuda`; defaults to `auto`.
- `ORACLE_VOICE_COMPUTE_TYPE`: `auto`, `int8`, `int8_float16`, `float16`, or `float32`.
- `ORACLE_VOICE_PREPROCESS`: `false` by default. Set to `true` only after comparing diagnostics for noisy recordings.

`GET /api/v1/voice/diagnostics` reports the selected model, runtime device, language, last transcription details, and the engine used for the last successful spoken reply. Individual requests can use `?preprocess=true|false`. The transcript preserves ambiguous phrases such as “open it” for the intent parser to handle.

```powershell
.\backend\.venv\Scripts\python.exe scripts\prepare_voice_model.py
```

The setup command downloads Whisper Tiny English. For better transcription or Sinhala support, install multilingual Whisper Small and restart the backend:

```powershell
.\backend\.venv\Scripts\python.exe scripts\prepare_voice_model.py --model small
```

Use `en` for English commands, `si` for Sinhala, or `auto` for language detection per recording. Setup pins the downloaded revision and records local file hashes. Runtime inference uses local model files.

### Parakeet for English

From the project root, install the optional runtime and extract the model into
`models`, then restart Oracle:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install sherpa-onnx
$oracleParakeetArchive = Join-Path $env:TEMP 'oracle-parakeet-v2-int8.tar.bz2'
curl.exe --fail --location --output $oracleParakeetArchive https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2
if ($LASTEXITCODE -eq 0) { tar.exe -xf $oracleParakeetArchive -C models }
```

With `ORACLE_VOICE_LANGUAGE=en`, Parakeet handles completed push-to-talk and
hands-free recordings on CPU. Whisper handles wake-word requests and live
caption previews, and serves as the fallback. Check
`last_transcription.engine` in voice diagnostics after a push-to-talk test.

## Use and limits

- Wake the interface, then tap the microphone/globe or use Push to talk. Permission denial leaves typing available.
- Finish recording to transcribe; review the draft and select Send. No clear speech produces an honest message rather than an invented command.
- Record at most 45 seconds/4 MiB. The client finishes at 44 seconds to leave encoding margin. The server independently bounds decoded samples and rejects video streams or invalid audio.
- Enable Read replies aloud for local WAV playback. At most the first 2,000 characters are synthesized per request; the full reply remains visible.
- Stop cancels pending transcripts and playback. Sleep, mode changes, and unmount tear down automatic listening. A local inference or synthesis already running can finish in the backend. The browser discards its result after cancellation.
- Raw microphone audio is not written to the records database or sent to Gemini. Transcription is in memory. Explicit test fixtures are synthetic WAV files in ignored readiness data, not user recordings.
- Tiny English recognition is a baseline, not an accuracy guarantee. Review transcripts. Trailing sentence punctuation and spacing variants such as “note pad” are accepted only when they still resolve to an existing approved application ID. Spoken timer numbers one through ten are supported.
- Voice intent parsing is separate from transcription. Exact high-confidence map/settings commands execute directly; ambiguous phrases such as “open it” remain in the draft and request clarification instead of being forced into an action.

## Acceptance and remaining checks

### Compare local recognition models

Create a JSON manifest beside your recordings. Set `kind` to `command` for short commands, set `wake` to `true` for wake-mode recordings, and leave `text` empty for noise-only clips.

```json
[
  {"file": "map.wav", "text": "open map", "kind": "command"},
  {"file": "wake.wav", "text": "hey oracle", "wake": true},
  {"file": "fan.wav", "text": ""}
]
```

```powershell
.\backend\.venv\Scripts\python.exe scripts\benchmark_voice.py path\to\manifest.json
.\backend\.venv\Scripts\python.exe scripts\benchmark_voice.py path\to\manifest.json --model path\to\another-local-model --language en
```

The report includes word error rate, exact command matches, transcripts on noise clips, and median and 95th-percentile backend latency. Run both models on the same clips. Use `--preprocess` or `--no-preprocess` for a noise-filter comparison. Use a multilingual model with `--language si` or `--language auto` for Sinhala or mixed-language trials. The benchmark reads recordings locally and prints their reference and recognized text. It measures backend recognition, so browser detection and speaker playback need separate checks.

### Existing checks

Real local speech synthesis/transcription tests generate “Open notepad,” transcribe it and verify the resulting backend request proposes the mapped action without launching it. Network-blocked Python tests pass with prepared local assets. Browser tests verify review-before-send and cancellation of a delayed local speech response. These are synthetic-audio tests, not a human microphone or speaker check. Final verification: 84 backend tests and 38 browser tests passed, along with frontend build/lint, dependency checks and the read-only integration gate.

The user authorized a physical camera preview check: it reported 1280×720, ready state 4 and active playback, then was explicitly stopped. Continuous focus was unavailable. No physical camera frame was captured or saved. Printed-label OCR/memory acceptance remains open. The user explicitly chose to leave the human microphone test pending; no microphone activation was performed for that check. Human speech intelligibility and audible playback acceptance therefore remain open.

## Phase 7 groundwork

Run `scripts/check_integration.py` using the backend Python environment while the gateway is running. It checks health, authorization, active PostgreSQL, image-reading/memory availability and local voice readiness, and writes an ignored readiness report. It does not activate sensors, generate cloud replies, launch applications or use Ollama. Full integrated phase sign-off still requires the outstanding physical journeys and resource/offline checks.

References: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Windows speech file output](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee125549%28v%3Dvs.85%29).
