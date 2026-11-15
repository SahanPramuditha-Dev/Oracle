# Camera audit

| Area | Finding | Status |
| --- | --- | --- |
| Camera source | Reopening the active device is unnecessary. An ended event from a previous stream can arrive after a switch. | Ignore same-device selection and guard ended events by stream identity. |
| Live preview | The overlay dimensions previously depended on unrelated renders after video metadata changed. | Update frame geometry on loaded data and intrinsic video resize. Verify boxes with portrait, landscape, and mirrored feeds. |
| Capture | Multiple requests could encode duplicate stills. A completed encode could hand off a frame after the source changed. | Disable capture during encoding and verify the source before handoff. |
| Live QR | Switching cameras could leave the previous result visible. An in-flight scan could complete after cleanup. | Reset the result and abort the fallback request on cleanup. |
| Still crop | Letterboxing could offset the crop rectangle, and invalid crop extents could reach the server. | Size the crop overlay to the displayed image and block out-of-bounds reads. The server still validates the minimum pixel size. |
| OCR and review | The reader hid the title and description until extraction produced content. The Stop control also appeared during saves. | Allow manual descriptions, disclose truncated OCR, and offer Stop during reading only. |
| Product | Product scanning supports a live frame, image upload, and typed search. | Existing workflow retained. Verify exact barcode matches and uncertain label results with real packaging. |
| Navigation | Live controls, image reading in chat, and product scanning use separate entry points. | The active camera card now exposes Live, Read, and Product actions in one place. Read hands off to the existing still-image editor. The standalone Product scanner remains available without a camera. |

## Physical acceptance

Use an actual webcam and a phone camera to check permission denial, disconnect and reconnect, camera switching, portrait framing, and mirror alignment. Capture a printed label with small text and a QR code in normal light, glare, and low light. Compare OCR against the source text, record exact QR and barcode decode rates, and verify that cropped reads follow the visible selection. For live objects, record misses, false positives, and time to stable detection on the same clips before and after any tuning. Software checks cannot establish a hardware accuracy baseline.

## Verification results

- Frontend production build passed.
- All 23 targeted backend tests for reading, detector geometry, and product intelligence passed.
- Browser checks passed for portrait preview geometry, camera modes, capture-to-reader handoff, crop validation, and standalone product upload with manual correction.
- The longer camera controls test passed through camera switching, a failed-source fallback, and turning person tracking off. It did not consistently restore both person reticles after tracking was re-enabled. Physical-device checks and detector tuning remain open.
