"""Disposable PDF text extraction worker. Never execute embedded PDF actions."""
import io
import json
import sys
from pypdf import PdfReader


def extract(data):
    if not data.startswith(b'%PDF-') or len(data) > 5 * 1024 * 1024:
        raise ValueError('Use a PDF of up to 5 MB')
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError('Encrypted PDFs are not supported')
    if len(reader.pages) > 40:
        raise ValueError('Use a PDF of up to 40 pages')
    pages = []
    remaining = 20000
    for number, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or '').replace('\x00', '')
        if len(text) > remaining:
            raise ValueError('PDF exceeds 20,000 extracted characters; split the document first')
        remaining -= len(text)
        pages.append({'page': number, 'text': text})
    if not any(page['text'].strip() for page in pages):
        raise ValueError('No selectable PDF text found. Scanned PDFs need OCR, which is not included here.')
    return {'pages': pages, 'page_count': len(pages)}


if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.stdin.buffer.read(5 * 1024 * 1024 + 1))))
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else 'PDF could not be safely read'
        print(json.dumps({'error': message}))
        sys.exit(1)
