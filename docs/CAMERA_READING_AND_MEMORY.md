# Camera reading and approved image memory

## Current implementation

Phase 4's software path is implemented: explicit still capture or file selection, keyboard/touch crop controls, local-backend OCR, inert QR preview, editable recognition and explicit corrected-note saving. Phase 5 adds explicit image/description saving, keyword retrieval, backend save time, correction and deletion. Physical camera permission, focus and a real printed-label demonstration remain device acceptance checks; generated-image tests do not replace them.

No Ollama, cloud vision API or paid service is used. The browser captures/selects and displays the image; FastAPI validates and processes it. OCR uses RapidOCR's packaged ONNX models on CPU, initialized lazily and reused. QR decoding uses OpenCV. Model assets ship with the installed package, so inference does not fetch a remote model or upload images to Gemini. The initial supported reading target is clear English labels; recognition can omit spaces or misread characters. Always review results.

## Use

1. Open Camera and explicitly start it, or choose a PNG/JPEG file when camera access is denied/unavailable.
2. Capture a still. Capture stops the live stream and produces a JPEG bounded to 2000 pixels per side for upload efficiency. Adjust Left/Top/Width/Height crop sliders; the rectangle shows the selected region.
3. Select **Read text & QR**. Only that explicit action sends the still to the local backend. QR contents remain untrusted plain text; neither URLs nor scripts open automatically.
4. Review/correct recognized text and enter a title. **Save corrected text as note** stores only text. **Save image & description as memory** explicitly stores the image and description.
5. Type `memories` or `find memories <words>` to open saved memories. Search, view the image, edit the description or delete the memory. Searches remain local and do not enter the Gemini conversation context.

Stopping a read cancels waiting and ignores late responses; inference already running may finish locally. Closing/discarding a photo releases the view and aborts waiting. It does not undo an explicitly submitted save. OCR processing itself does not create an image memory.

## Backend limits and persistence

- Authenticated image reading accepts only decoded still PNG/JPEG, up to 6 MiB and 12 megapixels. Invalid data, unsupported formats, out-of-bounds or sub-16-pixel crops are rejected. The backend resizes inference input to at most 2000 pixels on either side.
- A nonblocking lock permits one local OCR/QR inference at a time; additional reads receive an honest busy response. OCR uses two intra-operation and one inter-operation CPU threads. Text is limited to 12,000 characters; the response reports truncation. QR previews are bounded to eight payloads of at most 4096 characters each.
- Memory saving revalidates the image independently. It applies orientation, flattens transparency, strips metadata, scales to at most 1600 pixels on either side and stores a JPEG, dimensions and SHA-256 in PostgreSQL. The original upload bytes are not archived.
- Alembic revision `0002_image_memory` creates the memory table and quota-lock row. A maximum of 100 image memories is enforced transactionally. Image bytes and metadata live in one row, so deletion removes both from active storage without leaving a separate asset file.
- Provenance includes backend save time, client-declared camera/file source and submitted original OCR text. This is not forensic proof of capture time or an authenticated original OCR transcript. Corrections affect the searchable title/description while preserving the submitted OCR text.
- Deletion affects active records and future retrieval. Existing database backups can still contain older copies; manage backup retention separately. Images and descriptions are private local data, not shared assets or automatically retrieved model context.

## Verification

The synthetic label generator is `scripts/prepare_reading_fixture.py`; its output stays in ignored `data/readiness/reading-fixtures`. It does not open a sensor or contact a network. Tests use actual local OCR/QR on that image, validate crop/size/auth boundaries, exercise cancellation and inert QR payloads, and run corrected-note and full image-memory lifecycles through the real PostgreSQL-backed UI. Separate tests verify memory bytes survive a new database connection and that deletion makes the asset unavailable. A real PostgreSQL/backend restart and a restore into a disposable database also preserved metadata and the saved asset SHA-256. Final validation: 80 backend tests and 36 browser tests, build/lint and dependency checks passed; evidence is in ignored `data/readiness/phase4-phase5-gate.json`.

Outstanding manual check: capture a real printed label on this machine, confirm useful focus and crop accuracy, correct its text, explicitly save it, find it and delete it. Physical voice acceptance belongs to Phase 6; these image checks do not sign off that phase.

References: [RapidOCR](https://github.com/RapidAI/RapidOCR), [OpenCV QR decoding](https://docs.opencv.org/4.5.2/de/dc3/classcv_1_1QRCodeDetector.html).
