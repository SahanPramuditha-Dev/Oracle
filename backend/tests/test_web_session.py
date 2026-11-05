from fastapi.testclient import TestClient
from app.main import create_app


def test_session_never_exposes_api_token_and_cookie_authenticates():
    with TestClient(create_app(token='private-backend-key')) as client:
        assert client.get('/api/v1/auth/session').status_code == 401
        response=client.get('/api/v1/auth/session',headers={'X-Oracle-Client':'web','Sec-Fetch-Site':'same-origin'})
        assert response.status_code==200 and response.json()=={'authenticated':True}
        cookie=response.headers['set-cookie']
        assert 'HttpOnly' in cookie and 'SameSite=strict' in cookie and 'private-backend-key' not in cookie
        assert client.get('/api/v1/capabilities').status_code==200
        assert client.get('/api/v1/capabilities',headers={'Origin':'https://foreign.example'}).status_code==403


def test_cross_site_session_and_bad_cookie_fail_closed():
    with TestClient(create_app(token='private-backend-key')) as client:
        assert client.get('/api/v1/auth/session',headers={'X-Oracle-Client':'web','Sec-Fetch-Site':'cross-site'}).status_code==401
        client.cookies.set('oracle_session','wrong')
        assert client.get('/api/v1/capabilities').status_code==401
        assert client.get('/api/v1/telemetry/sensors').status_code==401
