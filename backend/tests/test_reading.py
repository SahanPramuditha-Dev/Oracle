from io import BytesIO
from pathlib import Path
import threading

import cv2
import pytest
from PIL import Image, ImageDraw, ImageFont, ImageOps
from fastapi.testclient import TestClient
from app.main import create_app
from app.reading import ImageReader, MAX_IMAGE_BYTES

AUTH = {'Authorization': 'Bearer reading-test', 'Content-Type': 'image/png'}


def png(size=(300, 100)):
    output = BytesIO()
    Image.new('RGB', size, 'white').save(output, format='PNG')
    return output.getvalue()


def client(reader=None):
    return TestClient(create_app(token='reading-test', reader=reader or ImageReader(engine=lambda image: (None, None))))


def test_reading_requires_auth_and_allowed_origin():
    with client() as app:
        assert app.post('/api/v1/images/read', content=png()).status_code == 401
        assert app.post('/api/v1/images/read', headers=AUTH | {'Origin': 'https://foreign.example'}, content=png()).status_code == 403


def test_image_limits_type_decode_and_crop_validation():
    with client() as app:
        for payload, mime, status in [(b'x'*(MAX_IMAGE_BYTES+1),'image/png',413),
                                     (b'invalid','image/png',422), (png(),'image/svg+xml',415),
                                     (png((4000, 3100)),'image/png',413)]:
            assert app.post('/api/v1/images/read', headers=AUTH | {'Content-Type':mime}, content=payload).status_code == status
        for crop in ['x=90&width=20', 'width=0', 'width=1&height=1', 'x=-1']:
            assert app.post('/api/v1/images/read?'+crop, headers=AUTH, content=png()).status_code == 422


def test_empty_read_is_honest_and_not_stored():
    with client() as app:
        response = app.post('/api/v1/images/read', headers=AUTH, content=png())
        assert response.status_code == 200
        assert response.json()['text'] == '' and response.json()['qr'] == []
        assert response.json()['stored'] is False and response.json()['confidence'] is None


def test_crop_reaches_actual_engine():
    seen = []
    def engine(image):
        seen.append(image.shape)
        return [[[[], 'Read text', 0.9]]][0], None
    with client(ImageReader(engine=engine)) as app:
        result = app.post('/api/v1/images/read?x=10&y=20&width=50&height=50', headers=AUTH, content=png()).json()
    assert seen == [(50,150,3)] and result['text'] == 'Read text'


def test_busy_reader_rejects_overlapping_inference():
    reader = ImageReader()
    reader.lock.acquire()
    try:
        with client(reader) as app:
            assert app.post('/api/v1/images/read', headers=AUTH, content=png()).status_code == 429
    finally:
        reader.lock.release()


def test_real_ocr_and_qr_on_label_fixture(tmp_path):
    picture = Image.new('RGB', (1200,600), 'white')
    font_path = Path('C:/Windows/Fonts/arial.ttf')
    if not font_path.exists():
        pytest.skip('Windows label font not present')
    ImageDraw.Draw(picture).multiline_text((40,70), 'ORACLE CAMERA TEST\nBATCH A12345', fill='black',
        font=ImageFont.truetype(str(font_path),38), spacing=24)
    qr = Image.fromarray(cv2.QRCodeEncoder_create().encode('https://example.com/oracle-test'))
    qr = ImageOps.expand(qr,border=4,fill=255).resize((330,330),Image.Resampling.NEAREST)
    picture.paste(qr,(820,70))
    output = BytesIO(); picture.save(output, format='PNG')
    reader = ImageReader()
    result = reader.read(output.getvalue(), (0,0,100,100))
    assert 'A12345' in result['text'] and result['qr'] == ['https://example.com/oracle-test']
    assert reader.read(output.getvalue(), (0,0,65,100))['qr'] == []
