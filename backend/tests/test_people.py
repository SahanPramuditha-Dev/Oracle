from io import BytesIO
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.database import database_engine, migrate
from app.main import create_app
from app.people import PersonRecognizer

AUTH = {'Authorization': 'Bearer test-credential'}
FIXTURE_PATH = Path(__file__).resolve().parents[2] / 'data/readiness/vision-fixtures/portrait.jpg'


@pytest.fixture
def recognizer(tmp_path):
    db_path = tmp_path / 'people.sqlite3'
    engine = database_engine(db_path)
    migrate(engine)
    return PersonRecognizer(engine)


@pytest.fixture
def client(recognizer):
    app = create_app(token='test-credential', recognizer=recognizer)
    return TestClient(app)


def test_capabilities_shows_face_recognition(client):
    caps = client.get('/api/v1/capabilities', headers=AUTH).json()
    assert caps['face_recognition'] is True


def test_unauthorized_access(client):
    assert client.get('/api/v1/people').status_code == 401
    assert client.post('/api/v1/people/enroll?name=Test').status_code == 401
    assert client.post('/api/v1/people/identify').status_code == 401


def test_enroll_list_identify_and_delete(client):
    assert FIXTURE_PATH.exists(), f'Fixture portrait missing at {FIXTURE_PATH}'
    portrait_bytes = FIXTURE_PATH.read_bytes()

    # 1. Initial list should be empty
    list_res = client.get('/api/v1/people', headers=AUTH)
    assert list_res.status_code == 200
    assert list_res.json()['people'] == []

    # 2. Enroll a person
    enroll_res = client.post(
        '/api/v1/people/enroll?name=Sahan&notes=Lead%20Architect',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    )
    assert enroll_res.status_code == 200
    data = enroll_res.json()
    assert data['name'] == 'Sahan'
    assert data['notes'] == 'Lead Architect'
    assert 'id' in data
    assert 'face_box' in data
    person_id = data['id']

    # 3. List should contain enrolled person without embedding exposed
    list_res = client.get('/api/v1/people', headers=AUTH)
    assert list_res.status_code == 200
    people = list_res.json()['people']
    assert len(people) == 1
    assert people[0]['id'] == person_id
    assert people[0]['name'] == 'Sahan'
    assert 'embedding' not in people[0]

    # 4. Identify enrolled person in image
    ident_res = client.post(
        '/api/v1/people/identify',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    )
    assert ident_res.status_code == 200
    ident_data = ident_res.json()
    assert ident_data['faces_detected'] == 1
    assert ident_data['has_match'] is True
    assert ident_data['identified'][0]['name'] == 'Sahan'
    assert ident_data['identified'][0]['matched'] is True
    assert ident_data['identified'][0]['cosine_score'] >= 0.363
    assert 'confidence' not in ident_data['identified'][0]
    assert ident_data['identified'][0]['is_admin'] is False

    # 5. Delete person
    del_res = client.delete(f'/api/v1/people/{person_id}', headers=AUTH)
    assert del_res.status_code == 200
    assert del_res.json() == {'deleted': True, 'id': person_id}

    # 6. Deleting again should return 404
    assert client.delete(f'/api/v1/people/{person_id}', headers=AUTH).status_code == 404

    # 7. Identify after deletion should detect face but report Unknown
    ident_after = client.post(
        '/api/v1/people/identify',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    )
    assert ident_after.status_code == 200
    assert ident_after.json()['has_match'] is False
    assert ident_after.json()['identified'][0]['name'] == 'Unknown'


def test_enroll_rejects_image_without_face(client):
    # Create solid white image with no faces
    img = Image.new('RGB', (200, 200), color='white')
    buf = BytesIO()
    img.save(buf, format='JPEG')

    res = client.post(
        '/api/v1/people/enroll?name=Ghost',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=buf.getvalue(),
    )
    assert res.status_code == 422
    assert 'No face detected' in res.json()['detail']


def test_verify_1_to_1_matching(client):
    portrait_bytes = FIXTURE_PATH.read_bytes()

    # Enroll Sahand
    enroll = client.post(
        '/api/v1/people/enroll?name=Sahand&notes=Admin',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    ).json()
    person_id = enroll['id']

    # 1:1 Verification by ID
    ver_res = client.post(
        f'/api/v1/people/verify?person_id={person_id}',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    )
    assert ver_res.status_code == 200
    ver_data = ver_res.json()
    assert ver_data['verified'] is True
    assert ver_data['target_name'] == 'Sahand'
    assert ver_data['cosine_score'] >= 0.363
    assert ver_data['access_allowed'] is False
    assert ver_data['liveness'] == 'not_evaluated'
    assert ver_data['expires_at'] is not None

    # 1:1 Verification by Name
    ver_name = client.post(
        '/api/v1/people/verify?name=Sahand',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    )
    assert ver_name.status_code == 200
    assert ver_name.json()['verified'] is True

    # Unknown identity returns 404
    assert client.post(
        '/api/v1/people/verify?name=Nobody',
        headers={**AUTH, 'Content-Type': 'image/jpeg'},
        content=portrait_bytes,
    ).status_code == 404

    # Clean up
    client.delete(f'/api/v1/people/{person_id}', headers=AUTH)


def test_same_name_creates_distinct_identities_and_delete_is_scoped(client):
    portrait_bytes = FIXTURE_PATH.read_bytes()
    first = client.post('/api/v1/people/enroll?name=Same',headers={**AUTH,'Content-Type':'image/jpeg'},content=portrait_bytes).json()
    second = client.post('/api/v1/people/enroll?name=Same',headers={**AUTH,'Content-Type':'image/jpeg'},content=portrait_bytes).json()
    assert first['id'] != second['id']
    assert len(client.get('/api/v1/people',headers=AUTH).json()['people'])==2
    assert client.post('/api/v1/people/verify?name=Same',headers={**AUTH,'Content-Type':'image/jpeg'},content=portrait_bytes).status_code==409
    client.delete(f"/api/v1/people/{first['id']}",headers=AUTH)
    assert client.get('/api/v1/people',headers=AUTH).json()['people'][0]['id']==second['id']


def test_duplicate_sample_rejected_and_explicit_id_required(client):
    portrait_bytes=FIXTURE_PATH.read_bytes()
    first=client.post('/api/v1/people/enroll?name=Multi',headers={**AUTH,'Content-Type':'image/jpeg'},content=portrait_bytes).json()
    assert client.post('/api/v1/people/enroll?name=Multi&append_sample=true',headers={**AUTH,'Content-Type':'image/jpeg'},content=portrait_bytes).status_code==422
    r=client.post(f"/api/v1/people/enroll?name=Multi&person_id={first['id']}&append_sample=true",headers={**AUTH,'Content-Type':'image/jpeg'},content=portrait_bytes)
    assert r.status_code==409
    assert 'Duplicate' in r.json()['detail']
    assert client.get('/api/v1/people',headers=AUTH).json()['people'][0]['sample_count']==1


def test_permissions_are_explicit_and_revocation_blocks_matching(client):
    payload=FIXTURE_PATH.read_bytes()
    identity=client.post('/api/v1/people/enroll?name=Sahan&notes=ROOT_ADMIN_AUTHORITY',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()
    pid=identity['id']
    def identify():
        return client.post('/api/v1/people/identify',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()
    assert not identify()['has_admin']
    r=client.patch(f'/api/v1/people/{pid}',headers=AUTH,json={'permission':'administrator','relationship':'owner'})
    assert r.status_code==200
    assert identify()['has_admin']
    assert not identify()['identified'][0]['access_allowed']
    assert client.patch(f'/api/v1/people/{pid}',headers=AUTH,json={'enrollment_state':'revoked'}).status_code==200
    assert not identify()['has_match']
    assert not client.post(f'/api/v1/people/verify?person_id={pid}',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()['verified']


def test_ambiguous_distinct_identities_are_not_recognized(client):
    payload=FIXTURE_PATH.read_bytes()
    first=client.post('/api/v1/people/enroll?name=One',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()
    client.post('/api/v1/people/enroll?name=Two',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload)
    match=client.post('/api/v1/people/identify',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()['identified'][0]
    assert match['recognition_state']=='uncertain'
    assert match['matched'] is False
    assert match['id'] is None
    result=client.post(f"/api/v1/people/verify?person_id={first['id']}",headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()
    assert result['verification_state']=='uncertain'
    assert not result['verified']


def test_profile_validation_and_sample_deletion(client):
    payload=FIXTURE_PATH.read_bytes()
    identity=client.post('/api/v1/people/enroll?name=One',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()
    pid=identity['id']
    assert client.patch(f'/api/v1/people/{pid}',headers=AUTH,json={'permission':'root'}).status_code==422
    assert client.patch(f'/api/v1/people/{pid}',headers=AUTH,json={'name':'  '}).status_code==422
    assert client.patch(f'/api/v1/people/{pid}',headers=AUTH,json={'enrollment_state':'active'}).status_code==422
    assert client.delete(f"/api/v1/people/{pid}/samples/{identity['sample_id']}",headers=AUTH).status_code==200
    assert client.get('/api/v1/people',headers=AUTH).json()['people'][0]['sample_count']==0
    assert not client.post(f'/api/v1/people/verify?person_id={pid}',headers={**AUTH,'Content-Type':'image/jpeg'},content=payload).json()['verified']


def test_role_and_sample_routes_require_authorization(client):
    assert client.patch('/api/v1/people/missing',json={'permission':'administrator'}).status_code==401
    assert client.delete('/api/v1/people/missing/samples/missing').status_code==401
    assert client.post('/api/v1/people/verify?threshold=0.1',headers=AUTH).status_code==422
