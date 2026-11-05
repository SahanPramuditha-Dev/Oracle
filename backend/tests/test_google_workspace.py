import json
import time
from urllib.parse import parse_qs, urlsplit
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.google_workspace import GoogleWorkspace, ProtectedTokenStore, SCOPES, CALLBACK


class Store:
    def __init__(self):self.value={}
    def read(self):return dict(self.value)
    def write(self,value):self.value=dict(value)
    def clear(self):self.value={}


def service(tmp_path, handler):
    path=tmp_path/'client.json';path.write_text(json.dumps({'web':{'client_id':'client.apps.googleusercontent.com','client_secret':'private-client-secret'}}))
    return GoogleWorkspace(path,Store(),httpx.MockTransport(handler))


def tokens(**extra):
    return {'access_token':'private-access-token','refresh_token':'private-refresh-token','scope':' '.join(SCOPES),'expires_at':time.time()+3600,**extra}


def test_oauth_state_pkce_grants_and_no_browser_token_exposure(tmp_path):
    calls=[]
    def handler(request):
        calls.append(request)
        if str(request.url)=='https://openidconnect.googleapis.com/v1/userinfo':
            assert request.headers['Authorization']=='Bearer private-access-token'
            return httpx.Response(200,json={'sub':'google-user-1','email':'tester@example.com','email_verified':True})
        assert str(request.url)=='https://oauth2.googleapis.com/token'
        fields=parse_qs(request.content.decode())
        assert fields['redirect_uri']==[CALLBACK] and len(fields['code_verifier'][0])>=43
        assert fields['client_secret']==['private-client-secret']
        return httpx.Response(200,json=tokens(expires_in=3600))
    google=service(tmp_path,handler)
    with TestClient(create_app(token='local',google=google)) as client:
        assert client.post('/api/v1/google/connect').status_code==401
        auth={'Authorization':'Bearer local'}
        link=client.post('/api/v1/google/connect',headers=auth).json()['url']
        params=parse_qs(urlsplit(link).query)
        assert params['code_challenge_method']==['S256'] and params['access_type']==['offline']
        assert 'private-client-secret' not in link
        assert client.get('/api/v1/google/callback?state=wrong&code=code').status_code==400
        callback='/api/v1/google/callback?state='+params['state'][0]+'&code=one-time-code'
        response=client.get(callback);assert response.status_code==200
        assert 'private-access-token' not in response.text
        assert client.get(callback).status_code==400 and len(calls)==2
        status=client.get('/api/v1/google/status',headers=auth)
        assert status.json()['connected'] and status.json()['offline_access']
        assert status.json()['signed_in'] and status.json()['account']=={'email':'tester@example.com'}
        assert 'private-access-token' not in status.text and 'private-refresh-token' not in status.text


def test_partial_scopes_and_cancelled_oauth_are_not_connected(tmp_path):
    google=service(tmp_path,lambda request:httpx.Response(200,json=tokens(scope=SCOPES[0])))
    with TestClient(create_app(token='local',google=google)) as client:
        auth={'Authorization':'Bearer local'}
        state=parse_qs(urlsplit(client.post('/api/v1/google/connect',headers=auth).json()['url']).query)['state'][0]
        assert client.get('/api/v1/google/callback',params={'state':state,'code':'code'}).status_code==403
        assert not google.store.read()
        state=parse_qs(urlsplit(client.post('/api/v1/google/connect',headers=auth).json()['url']).query)['state'][0]
        assert client.get('/api/v1/google/callback',params={'state':state,'error':'access_denied'}).status_code==400


def test_refresh_calendar_reminders_and_task_date_semantics(tmp_path):
    calls=[]
    def handler(request):
        calls.append(request)
        if request.url.host=='oauth2.googleapis.com':
            assert parse_qs(request.content.decode())['grant_type']==['refresh_token']
            return httpx.Response(200,json={'access_token':'new-private-access','expires_in':3600})
        assert request.headers['Authorization']=='Bearer new-private-access'
        body=json.loads(request.content) if request.content else {}
        if '/events' in request.url.path:
            assert body['reminders']=={'useDefault':False,'overrides':[{'method':'popup','minutes':0}]}
            assert body['start']['dateTime'].endswith('+05:30')
            assert request.url.params['sendUpdates']=='none'
        if request.url.host=='tasks.googleapis.com':
            assert body['due']=='2026-12-12T00:00:00Z' and 'reminders' not in body
        return httpx.Response(200,json={'id':'external-id'})
    google=service(tmp_path,handler);google.store.write(tokens(expires_at=0))
    with TestClient(create_app(token='local',google=google),headers={'Authorization':'Bearer local'}) as client:
        event={'title':'Review','start':'2026-12-12T10:00:00+05:30','end':'2026-12-12T10:15:00+05:30','reminder_minutes':0,'operation_id':'a'*32}
        assert client.post('/api/v1/google/events',json=event).status_code==200
        assert client.post('/api/v1/google/tasks',json={'title':'Read','due_date':'2026-12-12'}).status_code==200
        assert len(calls)==3 and google.store.read()['refresh_token']=='private-refresh-token'
        assert client.post('/api/v1/google/events',json={**event,'end':event['start']}).status_code==422
        assert client.post('/api/v1/google/tasks',json={'title':'Read','due_date':'not-a-date'}).status_code==422


def test_failed_mutation_not_replayed_and_disconnect_clears_tokens(tmp_path):
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(503)
    google=service(tmp_path,handler);google.store.write(tokens())
    with TestClient(create_app(token='local',google=google),headers={'Authorization':'Bearer local'}) as client:
        assert client.post('/api/v1/google/tasks',json={'title':'Read'}).status_code==502
        assert len(calls)==1
        response=client.post('/api/v1/google/disconnect')
        assert response.json()['disconnected'] and response.json()['revoked'] is False
        assert not google.store.read()


def test_unconfigured_connection_has_clear_setup_status(tmp_path):
    google=GoogleWorkspace(tmp_path/'absent.json',Store())
    with TestClient(create_app(token='local',google=google),headers={'Authorization':'Bearer local'}) as client:
        assert not client.get('/api/v1/google/status').json()['configured']
        assert client.post('/api/v1/google/connect').status_code==503


def test_windows_tokens_are_encrypted_for_current_user(tmp_path):
    pytest.importorskip('win32crypt')
    store=ProtectedTokenStore(tmp_path/'google.dpapi')
    store.write(tokens())
    assert b'private-access-token' not in store.path.read_bytes()
    assert store.read()['refresh_token']=='private-refresh-token'
    store.clear();assert not store.path.exists()


def test_unverified_google_identity_is_not_saved_and_cancel_does_not_cancel_newer_flow(tmp_path):
    def handler(request):
        if request.url.host=='openidconnect.googleapis.com':
            return httpx.Response(200,json={'sub':'google-user-1','email':'tester@example.com','email_verified':False})
        return httpx.Response(200,json=tokens())
    google=service(tmp_path,handler)
    with TestClient(create_app(token='local',google=google),headers={'Authorization':'Bearer local'}) as client:
        def start():return parse_qs(urlsplit(client.post('/api/v1/google/connect').json()['url']).query)['state'][0]
        old=start();new=start()
        assert client.post('/api/v1/google/cancel-sign-in',json={'state':old}).json()['cancelled'] is False
        assert client.get('/api/v1/google/callback',params={'state':new,'code':'code'}).status_code==502
        assert not google.store.read()
        state=start()
        assert client.post('/api/v1/google/cancel-sign-in',json={'state':state}).json()['cancelled']
        assert client.get('/api/v1/google/callback',params={'state':state,'code':'code'}).status_code==400
