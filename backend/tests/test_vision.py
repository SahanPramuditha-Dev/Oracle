import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from app.detector import ObjectDetector
from app.main import create_app

AUTH = {'Authorization': 'Bearer test-credential'}

class MissingEveryday:
    available=False
    classes=['pen']

@pytest.fixture(autouse=True)
def isolate_optional_object_model(monkeypatch):
    monkeypatch.setattr('app.vision.EverydayObjectDetector',MissingEveryday)



class FakeVisionOllama:
    model = 'qwen2.5:1.5b'
    vision_model = 'moondream'

    async def answer(self, text, history):
        return 'Mock text answer'

    async def analyze_image(self, image_bytes: bytes, prompt: str) -> str:
        return f'Visual description for prompt: {prompt}'


def make_test_jpeg():
    img = Image.new('RGB', (200, 200), color='white')
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 160, 160], fill='blue')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


def test_vision_detect_endpoint():
    app = create_app(token='test-credential', detector=ObjectDetector())
    with TestClient(app) as client:
        # Check capabilities report object detection
        caps = client.get('/api/v1/capabilities', headers=AUTH).json()
        assert caps['object_detection'] is True

        # Test detection endpoint
        jpeg_bytes = make_test_jpeg()
        response = client.post(
            '/api/v1/vision/detect',
            headers={**AUTH, 'Content-Type': 'image/jpeg'},
            content=jpeg_bytes
        )
        assert response.status_code == 200
        data = response.json()
        assert 'detections' in data
        assert 'person_count' in data
        assert 'has_person' in data
        assert 'latency_ms' in data


def test_vision_ask_endpoint():
    fake_ollama = FakeVisionOllama()
    app = create_app(token='test-credential', ollama=fake_ollama)
    with TestClient(app) as client:
        # Check capabilities report vision QA
        caps = client.get('/api/v1/capabilities', headers=AUTH).json()
        assert caps['vision_qa'] is True

        jpeg_bytes = make_test_jpeg()
        response = client.post(
            '/api/v1/vision/ask?prompt=What is in the image?',
            headers={**AUTH, 'Content-Type': 'image/jpeg'},
            content=jpeg_bytes
        )
        assert response.status_code == 200
        data = response.json()
        assert data['provider'] == 'Ollama'
        assert data['model'] == 'moondream'
        assert data['processing'] == 'local'
        assert 'Visual description' in data['answer']


def test_vision_endpoints_require_auth():
    app = create_app(token='test-credential', detector=ObjectDetector())
    with TestClient(app) as client:
        jpeg_bytes = make_test_jpeg()
        assert client.post('/api/v1/vision/detect', content=jpeg_bytes).status_code == 401


def test_segmentation_endpoint_returns_mask_metadata():
    app = create_app(token='test-credential', detector=ObjectDetector())
    with TestClient(app) as client:
        response = client.post('/api/v1/vision/detect?segment=true',
            headers={**AUTH, 'Content-Type': 'image/jpeg'}, content=make_test_jpeg())
        assert response.status_code == 200
        data = response.json()
        assert data['segmentation'] is True
        assert data['image_width'] == 200
        assert data['image_height'] == 200


class FakeObjectOllama(FakeVisionOllama):
    async def analyze_image(self, image_bytes, prompt):
        assert prompt == 'What object is in the foreground?'
        assert 'pen' not in prompt.lower()
        return 'A blue ballpoint pen.'


def test_open_ended_object_recognition_uses_local_vision():
    app=create_app(token='test-credential',ollama=FakeObjectOllama())
    with TestClient(app) as client:
        r=client.post('/api/v1/vision/objects/identify',headers={**AUTH,'Content-Type':'image/jpeg'},content=make_test_jpeg())
        assert r.status_code==200
        assert r.json()['description']=='A blue ballpoint pen.'
        assert r.json()['processing']=='local'
        assert r.json()['is_estimate'] is True
        assert 'box' not in r.json()
        assert client.post('/api/v1/vision/objects/identify',content=b'').status_code==401
        assert client.post('/api/v1/vision/objects/identify',headers=AUTH,content=b'').status_code==415
        assert client.post('/api/v1/vision/objects/identify',headers={**AUTH,'Content-Type':'image/jpeg'},content=b'bad').status_code in {400,422}


def test_object_recognition_unavailable_without_local_vision():
    app=create_app(token='test-credential',detector=ObjectDetector())
    with TestClient(app) as client:
        r=client.post('/api/v1/vision/objects/identify',headers={**AUTH,'Content-Type':'image/jpeg'},content=make_test_jpeg())
        assert r.status_code==503


class FakeEveryday:
    available=True
    classes=['pen','scissors']
    def detect(self,image,people):
        return {'detections':[{'class':'pen','confidence':.8,'box':[10,10,80,80],'ambiguous':False},
            {'class':'scissors','confidence':.9,'box':[110,10,80,80],'ambiguous':False}],
            'model':'fake-world','latency_ms':1,'image_width':image.width,'image_height':image.height}


def test_detector_candidates_require_independent_description_agreement(monkeypatch):
    monkeypatch.setattr('app.vision.EverydayObjectDetector',FakeEveryday)
    app=create_app(token='test-credential',ollama=FakeObjectOllama())
    with TestClient(app) as client:
        data=client.post('/api/v1/vision/objects/identify',headers={**AUTH,'Content-Type':'image/jpeg'},content=make_test_jpeg()).json()
        assert data['source']=='open_vocabulary'
        assert data['cross_checked'] is True
        assert [d['class'] for d in data['detections']]==['pen']
        assert data['detections'][0]['corroborated'] is True
        caps=client.get('/api/v1/vision/objects/capabilities',headers=AUTH).json()
        assert caps['open_vocabulary'] is True
        assert 'pen' in caps['classes']
