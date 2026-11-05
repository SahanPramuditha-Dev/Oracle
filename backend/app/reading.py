"""Explicit, local-only still-image OCR/QR reading. Never persist or follow image contents."""
from io import BytesIO
import threading
import time
import warnings

from fastapi import APIRouter, HTTPException, Request, Query
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_PIXELS = 12_000_000


def decode_image(payload):
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(413, 'Choose a PNG or JPEG image up to 6 MB')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as source:
                if source.format not in {'PNG', 'JPEG'} or getattr(source, 'n_frames', 1) != 1:
                    raise HTTPException(415, 'Only still PNG and JPEG images are supported')
                if source.width * source.height > MAX_PIXELS:
                    raise HTTPException(413, 'Choose an image with at most 12 megapixels')
                oriented = ImageOps.exif_transpose(source).convert('RGBA')
                background = Image.new('RGBA', oriented.size, 'white')
                picture = Image.alpha_composite(background, oriented).convert('RGB')
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'This image could not be decoded safely') from None
    return picture


class ImageReader:
    def __init__(self, engine=None):
        self.engine = engine
        self.lock = threading.Lock()

    def read(self, payload, crop):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, 'An image is already being read. Wait for it to finish.')
        try:
            return self._read(payload, crop)
        finally:
            self.lock.release()

    def _read(self, payload, crop):
        started = time.perf_counter()
        picture = decode_image(payload)
        x, y, width, height = crop
        if x + width > 100 or y + height > 100:
            raise HTTPException(422, 'The selected crop must stay inside the image')
        original = {'width': picture.width, 'height': picture.height}
        picture = picture.crop((round(picture.width * x / 100), round(picture.height * y / 100),
                                round(picture.width * (x + width) / 100), round(picture.height * (y + height) / 100)))
        if min(picture.size) < 16:
            raise HTTPException(422, 'Select a crop at least 16 pixels wide and high')
        picture.thumbnail((2000, 2000))
        import cv2
        import numpy as np
        pixels = cv2.cvtColor(np.asarray(picture), cv2.COLOR_RGB2BGR)
        try:
            if self.engine is None:
                from rapidocr_onnxruntime import RapidOCR
                self.engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1, print_verbose=False)
            lines, _ = self.engine(pixels)
            decoded, values, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(pixels)
        except Exception:
            raise HTTPException(503, 'Local image reading failed. Try a clearer or smaller crop.') from None
        text = '\n'.join(str(line[1]) for line in (lines or []))
        qr = list(dict.fromkeys(value for value in values if value)) if decoded else []
        return {'text': text[:12000], 'truncated': len(text) > 12000,
                'qr': [value[:4096] for value in qr[:8]],
                'confidence': round(sum(float(line[2]) for line in lines) / len(lines), 3) if lines else None,
                'original': original, 'crop': {'x': x, 'y': y, 'width': width, 'height': height},
                'processing': 'local_backend', 'stored': False,
                'elapsed_ms': round((time.perf_counter() - started) * 1000)}


def reading_router(reader):
    router = APIRouter(prefix='/api/v1')

    @router.post('/images/read')
    async def read_image(request: Request, x: int = Query(0, ge=0, le=99), y: int = Query(0, ge=0, le=99),
                         width: int = Query(100, ge=1, le=100), height: int = Query(100, ge=1, le=100)):
        if request.headers.get('content-type', '').split(';')[0] not in {'image/png', 'image/jpeg'}:
            raise HTTPException(415, 'Send a still PNG or JPEG image')
        return await run_in_threadpool(reader.read, await request.body(), (x, y, width, height))

    return router
