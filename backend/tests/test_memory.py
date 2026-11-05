from io import BytesIO
from fastapi.testclient import TestClient
from PIL import Image
from app.main import create_app
from app.records import Records

AUTH = {'Authorization': 'Bearer memory-test'}


def image_bytes():
    output = BytesIO(); Image.new('RGB', (100,100), 'white').save(output, format='PNG')
    return output.getvalue()


def test_explicit_memory_save_search_edit_delete_and_asset_lifecycle(tmp_path):
    path = tmp_path / 'records.sqlite3'
    with TestClient(create_app(token='memory-test', records=Records(path))) as client:
        assert client.get('/api/v1/memories', headers=AUTH).json()['memories'] == []
        result = client.post('/api/v1/memories', headers=AUTH, data={
            'title':'Label', 'text':'Corrected batch', 'ocr_text':'Original OCR', 'source':'file'},
            files={'image':('label.png',image_bytes(),'image/png')})
        assert result.status_code == 201
        saved = result.json(); identity = saved['id']
        assert saved['source'] == 'file' and saved['created'] > 0 and len(saved['sha256']) == 64
    with TestClient(create_app(token='memory-test', records=Records(path))) as client:
        assert client.get('/api/v1/memories?q=batch', headers=AUTH).json()['memories'][0] == saved
        asset = client.get(f'/api/v1/memories/{identity}/image', headers=AUTH)
        assert asset.status_code == 200 and asset.headers['content-type'] == 'image/jpeg'
        assert Image.open(BytesIO(asset.content)).size == (100,100)
        client.put(f'/api/v1/memories/{identity}', headers=AUTH, json={'title':'Edited','text':'New description'}).raise_for_status()
        assert not client.get('/api/v1/memories?q=batch', headers=AUTH).json()['memories']
        updated = client.get('/api/v1/memories?q=New', headers=AUTH).json()['memories'][0]
        assert updated['ocr_text'] == 'Original OCR' and updated['sha256'] == saved['sha256']
        client.delete(f'/api/v1/memories/{identity}', headers=AUTH).raise_for_status()
        assert client.get(f'/api/v1/memories/{identity}/image', headers=AUTH).status_code == 404
        assert not client.get('/api/v1/memories', headers=AUTH).json()['memories']


def test_memory_authorization_and_invalid_images(tmp_path):
    with TestClient(create_app(token='memory-test', records=Records(tmp_path/'records.sqlite3'))) as client:
        assert client.get('/api/v1/memories').status_code == 401
        assert client.post('/api/v1/memories').status_code == 401
        assert client.get('/api/v1/memories/missing/image').status_code == 401
        assert client.post('/api/v1/memories', headers=AUTH, data={'title':'x','text':'y','source':'file'},
                           files={'image':('bad.png',b'not an image','image/png')}).status_code == 422
        assert client.post('/api/v1/memories', headers=AUTH, data={'title':'x','text':'y','source':'unexpected'},
                           files={'image':('label.png',image_bytes(),'image/png')}).status_code == 422
        assert not client.get('/api/v1/memories', headers=AUTH).json()['memories']
