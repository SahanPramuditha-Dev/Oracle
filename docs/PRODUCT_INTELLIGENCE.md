# Oracle product and brand identification

Open **Identify product** from Applications or select **Product** in the active Camera view. Product mode scans the camera frame automatically when the feed is ready. Use **Scan again** after repositioning the product, or upload a JPEG or PNG without camera permission.

The backend reads UPC-A, EAN-8, EAN-13 and compatible ITF barcodes locally with ZXing-C++. It validates the GTIN check digit before matching the local catalog. OCR reads visible labels, with a small brand alias list and catalog brand names supporting brand-only results. Optional local model observations appear as visual hints. The scanner separates catalog matches, visible label evidence, brand-only results, unknown barcodes and conflicts.

The synthetic seed catalog contains **Oracle Demo Lemon Sparkling Water, 330 mL**, with UPC-A `012345678905`. Search for **Oracle Demo** to check the catalog without a camera. The product API test generates and scans the UPC image. Coverage for real products depends on available catalog records.

For an unresolved barcode, choose **Look up barcode online** to send the barcode to Open Food Facts. Successful responses are cached for up to one hour in backend memory. Scans and photos are session-only. **Save product** stores the reviewed name, brand, variant, size and barcode in the current browser. Users can delete a saved record.

## API

- `POST /api/v1/vision/products/inspect` accepts a JPEG or PNG and returns the match status, evidence, and candidates.
- `POST /api/v1/vision/products/lookup` accepts local search terms or a barcode. Set `online: true` for explicit external lookup on a local miss.
- `GET /api/v1/vision/products/capabilities` reports available scanner components.

## Release verification

Evaluate physical cameras and labeled packaging across varied lighting, glare, curved and damaged labels, competing brands, and closely related variants. Measure exact-product precision, brand precision, unresolved rate, and time to result. Test keyboard navigation and announcements at desktop and mobile widths.
