# Phase 8 first increment — research tools

## PDF and cited-answer increment — 5 November 2026

The conversation toolbar's **Research** control now accepts PDF as well as TXT/Markdown. PDF processing uses `pypdf==6.21.4` in a disposable worker with a 20-second deadline. Limits: 5 MB, 40 pages and 20,000 extracted characters. Encrypted, unreadable, oversized and textless/scanned files are rejected with an explanation. Page numbers survive passage retrieval. No PDF actions or embedded JavaScript are executed; documents are not persisted. This is selectable-text extraction, not layout/table interpretation or scanned-page OCR.

**Answer with local AI** and **Summarize selected passages** call only the loopback Ollama model. There is no cloud fallback; remote Ollama endpoints and cloud-tagged models are rejected for this workflow. Generation shares the chat lock and daily development budget. JSON-schema-constrained output requires a source ID and exact supporting quote for each claim. Invalid references or invented quotes are rejected rather than shown as grounded answers. A matching quote does not prove the model's interpretation; review the original source. Summaries cover selected passages, not the complete document. Retrieval remains lexical, not a semantic index.

All three research browser scenarios passed, including real PDF extraction and page references; the browser AI rendering check uses a controlled response. A separate live gateway request to the real local model returned HTTP 200 with one validated cited claim. The full backend suite passed 139 tests; eleven focused research/provider checks and the production build also passed. No new model was downloaded. The already-installed Ollama service was started for the live check.

### Broader search connection

An optional SearXNG adapter now queries a configured loopback service using its JSON search API. It sanitizes result excerpts, rejects unsafe URL schemes, returns source links and reports provider failure without an automatic fallback. Set `ORACLE_SEARXNG_URL=http://127.0.0.1:8888` in the backend environment or ignored `backend/.env` only after a local instance is available. Restart the backend after configuration. The instance must enable `json` in `search.formats`; upstream engine/network restrictions still apply.

No SearXNG listener, Docker command or installed WSL distribution was found during this increment. The adapter is tested with controlled responses; broad-search live acceptance remains pending. No public instances, paid search subscriptions or policy-bypass requests were used. Wikipedia's previously observed robot-policy rejection remains a separate provider limitation.

Implementation references: [pypdf reader](https://pypdf.readthedocs.io/en/latest/modules/PdfReader.html), [Ollama structured outputs](https://ollama.com/blog/structured-outputs), [SearXNG search API](https://docs.searxng.org/dev/search_api.html).

The original first-increment record below is historical; the updates above supersede its PDF/model limitations.

Open conversation, then **Research & documents**. The existing chat, camera and records workflows remain available.

## Implemented

- Authenticated `POST /api/v1/research/search`: English Wikipedia source discovery using the public MediaWiki API. Returns up to five titles, plain-text excerpts, source URLs and retrieval time. Queries leave the device only after Search is pressed. No result-page fetching, inferred answers or automatic navigation.
- Authenticated `POST /api/v1/research/document`: local extractive retrieval over an explicitly selected UTF-8 `.txt` or `.md` document. Up to 20,000 characters; request bytes bounded separately. Questions return up to five literal matching passages with line/column citations. No matches produce an explicit absence result. Opening-passage preview is labelled as a preview, not an abstractive summary.
- Cancel/closure aborts pending requests and prevents late UI updates. Documents are not persisted, sent to a model or added to conversation history. Clear removes the active document from the tool. Uploaded text is treated as text, not instructions.
- No API keys, new packages, subscriptions or model downloads were required.

## Verification and limitations

Focused backend tests cover authorization, evidence citations, missing evidence, limits, invalid formats, fixed provider URLs, HTML removal and provider failures. The full backend suite passed 104 tests with PostgreSQL configured. All 13 browser tests passed together, including real backend document retrieval and controlled source-discovery/failure rendering. All ten live readiness gates passed. Build passed with the existing large-bundle advisory.

The live Wikipedia request received HTTP 403 with a robot-policy rejection from this network. It is reported as unavailable; no bypass or automatic fallback is attempted. Live search acceptance remains open. Deterministic search tests use provider fixtures and do not establish live availability.

The first increment does **not** complete Phase 8. General multi-source web search, full-page grounded answers, PDF/DOCX extraction, semantic document answers, persistent document collections, scoped file operations and routines remain future work. Keyword passage retrieval is deliberately labelled rather than presented as AI question answering.

Provider reference: [MediaWiki Search API](https://www.mediawiki.org/wiki/API:Search). Provider availability and usage rules apply even without an API key.
