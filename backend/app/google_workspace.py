"""Explicit single-user Google OAuth, Calendar and Tasks connection.

Credentials are never returned to the browser. No scheduled synchronization.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
import secrets
import ssl
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
CALLBACK = 'http://127.0.0.1:8000/api/v1/google/callback'
SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
          'https://www.googleapis.com/auth/tasks']


class HideOAuthQuery(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) >= 3 and isinstance(record.args[2], str) and '/api/v1/google/callback' in record.args[2]:
            args = list(record.args); args[2] = args[2].split('?')[0]; record.args = tuple(args)
        return True


logging.getLogger('uvicorn.access').addFilter(HideOAuthQuery())


class ProtectedTokenStore:
    """Windows user-bound DPAPI; do not fall back to plaintext on other systems."""
    def __init__(self, path=None):
        self.path = Path(path or ROOT / 'data/private/google-tokens.dpapi')

    def read(self):
        if not self.path.exists():
            return {}
        try:
            import win32crypt
            return json.loads(win32crypt.CryptUnprotectData(self.path.read_bytes(), None, None, None, 1)[1])
        except Exception:
            raise HTTPException(503, 'Google credentials cannot be unlocked by this Windows user. Disconnect and reconnect.') from None

    def write(self, value):
        try:
            import win32crypt
            encrypted = win32crypt.CryptProtectData(json.dumps(value).encode(), 'ORACLE Google', None, None, None, 1)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_bytes(encrypted); os.replace(temporary, self.path)
        except Exception:
            raise HTTPException(503, 'Google credentials could not be saved securely. No plaintext copy was made.') from None

    def clear(self):
        self.path.unlink(missing_ok=True)


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start: datetime
    end: datetime
    reminder_minutes: int = Field(default=10, ge=0, le=40320)
    operation_id: str = Field(pattern=r'^[a-f0-9]{32}$')

    @model_validator(mode='after')
    def valid_times(self):
        if not self.title.strip() or self.start.tzinfo is None or self.end.tzinfo is None or self.end <= self.start:
            raise ValueError('Use a title and an end after the start, with timezone offsets')
        return self


class GoogleTaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: str | None = None

    @field_validator('due_date')
    @classmethod
    def valid_date(cls, value):
        if value:
            date.fromisoformat(value)
        return value or None

    @field_validator('title')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('Enter a title')
        return value.strip()


class CompletionInput(BaseModel):
    completed: bool


class CancelSignInInput(BaseModel):
    state: str | None = Field(default=None, max_length=128)


class GoogleWorkspace:
    def __init__(self, config_path=None, store=None, transport=None):
        self.config_path = Path(config_path or ROOT / 'backend/google-client.json')
        self.store = store or ProtectedTokenStore()
        self.transport = transport
        self.pending = {}
        self.epoch = 0
        self.active_state = None
        self.lock = asyncio.Lock()

    def config(self):
        try:
            body = json.loads(self.config_path.read_text())
            if not isinstance(body, dict): raise ValueError()
            client = body.get('web') or body.get('installed') or {}
            if not isinstance(client, dict) or not isinstance(client.get('client_id'), str) or not isinstance(client.get('client_secret'), str) or not client['client_id'] or not client['client_secret']:
                raise ValueError()
            project = ({**dotenv_values(ROOT / 'backend/.env'), **os.environ}).get('ORACLE_GOOGLE_PROJECT_ID')
            if project and client.get('project_id') and client['project_id'] != project:
                raise HTTPException(503, 'The OAuth client belongs to a different Google project. Use the configured Firebase project.')
            return client
        except (OSError, ValueError, TypeError):
            raise HTTPException(503, 'Google OAuth setup is missing. Use the OAuth client from your Google/Firebase project.') from None

    def status(self):
        try:
            self.config(); configured = True
        except HTTPException:
            configured = False
        try:
            tokens = self.store.read(); notice = ''
        except HTTPException:
            tokens = {}; notice = 'Stored Google credentials cannot be unlocked. Reconnect Google.'
        account = tokens.get('account') or {}
        return {'configured': configured, 'connected': bool(tokens.get('refresh_token') or tokens.get('access_token')),
                'signed_in': bool(account.get('sub') and account.get('email')),
                'account': {'email': account['email']} if account.get('email') else None,
                'offline_access': bool(tokens.get('refresh_token')), 'scopes': tokens.get('scope', '').split(),
                'redirect_uri': CALLBACK, 'sync_mode': 'manual',
                'project_id': ({**dotenv_values(ROOT / 'backend/.env'), **os.environ}).get('ORACLE_GOOGLE_PROJECT_ID'), 'notice': notice}

    def start(self):
        client = self.config()
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        self.epoch += 1
        self.pending = {state: (time.monotonic() + 600, verifier, self.epoch)}
        self.active_state = state
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        return {'url': 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
            'client_id': client['client_id'], 'redirect_uri': CALLBACK, 'response_type': 'code',
            'scope': ' '.join(SCOPES), 'access_type': 'offline', 'prompt': 'consent',
            'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'})}

    async def http(self, method, url, **kwargs):
        try:
            async with httpx.AsyncClient(verify=ssl.create_default_context(), timeout=20,
                                         follow_redirects=False, transport=self.transport) as client:
                return await client.request(method, url, **kwargs)
        except httpx.RequestError:
            raise HTTPException(502, 'Google connection failed. Changes were not retried; refresh before trying again.') from None

    async def finish(self, state, code, error=None):
        pending = self.pending.pop(state, None)
        if not pending or pending[0] < time.monotonic():
            raise HTTPException(400, 'Google sign-in expired or was already used. Start again from ORACLE.')
        if error or not code:
            raise HTTPException(400, 'Google access was not granted. You can reconnect later.')
        client = self.config()
        async with self.lock:
            response = await self.http('POST', 'https://oauth2.googleapis.com/token', data={
                'grant_type': 'authorization_code', 'code': code, 'redirect_uri': CALLBACK,
                'client_id': client['client_id'], 'client_secret': client['client_secret'], 'code_verifier': pending[1]})
            if response.status_code != 200:
                raise HTTPException(400, 'Google could not complete sign-in. Check OAuth setup and try again.')
            if pending[2] != self.epoch:
                raise HTTPException(409, 'A newer Google connection replaced this sign-in. Use the latest sign-in window.')
            try:
                grant = response.json()
                if not set(SCOPES).issubset(self.granted_scopes(grant.get('scope', ''))):
                    raise HTTPException(403, 'Approve Google sign-in, Calendar and Tasks permissions to finish connecting.')
                access = grant['access_token']
                if not isinstance(access, str) or not access: raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise HTTPException(502, 'Google returned an unreadable sign-in response') from None
            # UserInfo is authenticated by the newly exchanged access token, not by
            # browser-supplied identity fields or an unverified decoded ID token.
            identity = await self.http('GET', 'https://openidconnect.googleapis.com/v1/userinfo',
                                       headers={'Authorization': 'Bearer ' + access})
            if identity.status_code != 200:
                raise HTTPException(502, 'Google account verification failed. Start sign-in again.')
            try:
                account = identity.json()
                if not isinstance(account.get('sub'), str) or not 1 <= len(account['sub']) <= 255 or account.get('email_verified') is not True or not isinstance(account.get('email'), str) or not 1 <= len(account['email']) <= 320:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(502, 'Google did not confirm a verified account email. No connection was saved.') from None
            if pending[2] != self.epoch:
                raise HTTPException(409, 'Use the latest Google sign-in window.')
            self.save_response(response, {'account': {'sub': account['sub'], 'email': account['email']}})

    @staticmethod
    def granted_scopes(value):
        return {'https://www.googleapis.com/auth/userinfo.email' if item == 'email' else item for item in value.split()}

    def save_response(self, response, previous=None):
        try:
            tokens = {**(previous or {}), **response.json()}
            if not tokens.get('access_token'):
                raise ValueError()
            scopes = self.granted_scopes(tokens.get('scope', ''))
            if not set(SCOPES).issubset(scopes):
                raise HTTPException(403, 'Grant Calendar and Tasks permissions to enable this connection.')
            tokens['expires_at'] = time.time() + int(tokens.get('expires_in', 3600))
            self.store.write(tokens)
        except (ValueError, TypeError):
            raise HTTPException(502, 'Google returned an unreadable credential response') from None

    async def access_token(self):
        async with self.lock:
            tokens = self.store.read()
            if tokens.get('access_token') and tokens.get('expires_at', 0) > time.time() + 60:
                return tokens['access_token']
            if not tokens.get('refresh_token'):
                raise HTTPException(401, 'Reconnect Google to continue.')
            client = self.config()
            response = await self.http('POST', 'https://oauth2.googleapis.com/token', data={
                'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token'],
                'client_id': client['client_id'], 'client_secret': client['client_secret']})
            if response.status_code != 200:
                raise HTTPException(401, 'Google access expired or was revoked. Reconnect Google.')
            self.save_response(response, tokens)
            return self.store.read()['access_token']

    async def api(self, method, path, *, tasks=False, **kwargs):
        token = await self.access_token()
        root = 'https://tasks.googleapis.com/tasks/v1/' if tasks else 'https://www.googleapis.com/calendar/v3/'
        response = await self.http(method, root + path, headers={'Authorization': 'Bearer ' + token}, **kwargs)
        if response.status_code in {401, 403}:
            raise HTTPException(response.status_code, 'Google access was denied. Check API enablement and granted permissions.')
        if response.status_code == 409:
            raise HTTPException(409, 'This Calendar event already exists. Refresh the event list.')
        if not response.is_success:
            raise HTTPException(502, 'Google request failed. Refresh before repeating a change; no automatic retry was made.')
        try:
            data = response.json() if response.content else {}
            if not isinstance(data, dict): raise ValueError()
            return data
        except ValueError:
            raise HTTPException(502, 'Google returned an unreadable response. Refresh before repeating a change.') from None

    async def disconnect(self):
        async with self.lock:
            try:
                tokens = self.store.read(); unreadable = False
            except HTTPException:
                tokens = {}; unreadable = True
            token = tokens.get('refresh_token') or tokens.get('access_token')
            revoked = not token and not unreadable
            if token:
                try:
                    response = await self.http('POST', 'https://oauth2.googleapis.com/revoke', data={'token': token})
                    revoked = response.status_code == 200
                except HTTPException:
                    pass
            self.store.clear(); self.pending.clear(); self.epoch += 1
            return {'disconnected': True, 'revoked': revoked,
                    'notice': 'Disconnected.' if revoked else 'Local credentials removed. Revoke ORACLE access in your Google Account as well.'}


def google_router(service, authorized, records=None):
    router = APIRouter(prefix='/api/v1/google')
    secure = [Depends(authorized)]

    @router.get('/status', dependencies=secure)
    def status(): return service.status()

    @router.post('/connect', dependencies=secure)
    def connect(): return service.start()

    @router.post('/cancel-sign-in', dependencies=secure)
    def cancel_sign_in(body: CancelSignInInput):
        matched = bool(body.state and body.state == service.active_state)
        if matched:
            service.pending.pop(body.state, None); service.epoch += 1; service.active_state = None
        return {'cancelled': matched}

    @router.get('/callback')
    async def callback(state: str = '', code: str = '', error: str | None = None):
        await service.finish(state, code, error)
        return HTMLResponse('<!doctype html><title>ORACLE Google connection</title><h1>Google connected</h1><p>Return to ORACLE and refresh the Google connection. You may close this tab.</p>', headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"})

    @router.post('/disconnect', dependencies=secure)
    async def disconnect(): return await service.disconnect()

    @router.get('/calendars', dependencies=secure)
    async def calendars():
        data = await service.api('GET', 'users/me/calendarList', params={'maxResults': 100})
        return {'calendars': [{key: item.get(key) for key in ['id', 'summary', 'accessRole', 'timeZone']} for item in data.get('items', [])], 'more': bool(data.get('nextPageToken'))}

    @router.get('/events', dependencies=secure)
    async def events(calendar_id: str = 'primary'):
        now = datetime.now(timezone.utc)
        data = await service.api('GET', f'calendars/{quote(calendar_id, safe="")}/events', params={
            'timeMin': now.isoformat(), 'timeMax': (now + timedelta(days=14)).isoformat(), 'singleEvents': 'true', 'orderBy': 'startTime', 'maxResults': 100})
        return {'events': [{key: item.get(key) for key in ['id', 'summary', 'start', 'end', 'htmlLink', 'status']} for item in data.get('items', [])], 'more': bool(data.get('nextPageToken'))}

    @router.post('/events', dependencies=secure)
    async def add_event(body: EventInput, calendar_id: str = 'primary'):
        event = await service.api('POST', f'calendars/{quote(calendar_id, safe="")}/events', params={'sendUpdates': 'none'}, json={
            'id': body.operation_id, 'summary': body.title.strip(),
            'start': {'dateTime': body.start.isoformat()}, 'end': {'dateTime': body.end.isoformat()},
            'reminders': {'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': body.reminder_minutes}]}})
        return {'id': event.get('id'), 'htmlLink': event.get('htmlLink'), 'notice': 'Created in Google Calendar. Notifications depend on your Google settings and devices.'}

    @router.get('/tasklists', dependencies=secure)
    async def tasklists():
        data = await service.api('GET', 'users/@me/lists', tasks=True, params={'maxResults': 100})
        return {'tasklists': [{'id': item['id'], 'title': item.get('title', '')} for item in data.get('items', [])], 'more': bool(data.get('nextPageToken'))}

    @router.get('/tasks', dependencies=secure)
    async def tasks(tasklist_id: str = '@default'):
        data = await service.api('GET', f'lists/{quote(tasklist_id, safe="")}/tasks', tasks=True, params={'maxResults': 100, 'showCompleted': 'true', 'showHidden': 'true'})
        return {'tasks': [{key: item.get(key) for key in ['id', 'title', 'due', 'status']} for item in data.get('items', [])], 'more': bool(data.get('nextPageToken'))}

    @router.post('/tasks', dependencies=secure)
    async def add_task(body: GoogleTaskInput, tasklist_id: str = '@default'):
        payload = {'title': body.title}
        if body.due_date: payload['due'] = body.due_date + 'T00:00:00Z'
        data = await service.api('POST', f'lists/{quote(tasklist_id, safe="")}/tasks', tasks=True, json=payload)
        return {'id': data.get('id'), 'notice': 'Google task created. Its due date has no due time or notification configuration through this API.'}

    @router.patch('/tasks/{task_id}', dependencies=secure)
    async def complete_task(task_id: str, body: CompletionInput, tasklist_id: str = '@default'):
        await service.api('PATCH', f'lists/{quote(tasklist_id, safe="")}/tasks/{quote(task_id, safe="")}', tasks=True, json={
            'status': 'completed' if body.completed else 'needsAction', **({} if body.completed else {'completed': None})})
        return {'updated': True}

    return router
