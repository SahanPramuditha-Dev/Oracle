"""Short-lived gateway clearance for Oracle's administrator protocol."""

import re
import secrets
import time
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .people import DEFAULT_VERIFY_THRESHOLD

ATTEMPT_SECONDS = 120
GRANT_SECONDS = 300
WORDS = ('amber', 'birch', 'coral', 'delta', 'ember', 'fern', 'harbor', 'ivory',
         'jade', 'maple', 'north', 'ocean', 'pine', 'river', 'silver', 'willow')


@dataclass
class Attempt:
    deadline: float
    phrase: str
    person_id: str | None = None
    busy: bool = False
    consumed: bool = False


@dataclass(frozen=True)
class Grant:
    deadline: float
    person_id: str
    attempt_id: str


def active_admin(person):
    return (person.get('permission') == 'administrator'
            and person.get('enrollment_state') == 'active'
            and person.get('consent_status') == 'granted')


class AdminProtocol:
    def __init__(self, recognizer, on_verified=None):
        self.recognizer = recognizer
        self.on_verified = on_verified
        self.lockdown_pending = False
        self.attempts: dict[str, Attempt] = {}
        self.grants: dict[str, Grant] = {}

    def revoke_all(self):
        self.attempts.clear()
        self.grants.clear()

    def admin(self, person_id):
        if self.recognizer is None:
            return None
        return next((p for p in self.recognizer.list_people()
                     if p['id'] == person_id and active_admin(p)), None)

    def prune(self):
        now = time.monotonic()
        self.attempts = {key: value for key, value in self.attempts.items() if value.deadline > now}
        self.grants = {key: value for key, value in self.grants.items() if value.deadline > now}

    def check_attempt(self, attempt_id, attempt):
        if self.attempts.get(attempt_id) is not attempt or attempt.deadline <= time.monotonic():
            raise HTTPException(410, 'Verification expired or was cancelled. Reopen Admin Protocol.')

    async def require(self, request: Request):
        credential = request.headers.get('x-oracle-admin-grant', '')
        self.prune()
        grant = self.grants.get(credential)
        if grant:
            admin = await run_in_threadpool(self.admin, grant.person_id)
            if admin and self.grants.get(credential) is grant and grant.deadline > time.monotonic():
                return admin
            self.grants.pop(credential, None)
        raise HTTPException(403, 'Active Administrator Protocol clearance required')

    def router(self):
        router = APIRouter(prefix='/api/v1/admin')

        @router.post('/attempts')
        async def begin():
            if self.lockdown_pending:
                raise HTTPException(409, 'Wait for Lockdown to finish before verifying.')
            if self.recognizer is None:
                raise HTTPException(503, 'Biometric verification is unavailable')
            self.prune()
            if len(self.attempts) >= 16:
                raise HTTPException(429, 'Too many verification attempts. Try again shortly.')
            attempt_id = secrets.token_urlsafe(32)
            phrase = ' '.join(secrets.choice(WORDS) for _ in range(5))
            self.attempts[attempt_id] = Attempt(time.monotonic() + ATTEMPT_SECONDS, phrase)
            return {'id': attempt_id, 'expires_in_seconds': ATTEMPT_SECONDS}

        @router.post('/attempts/{attempt_id}/face')
        async def face(attempt_id: str, request: Request):
            self.prune()
            attempt = self.attempts.get(attempt_id)
            if not attempt:
                raise HTTPException(410, 'Verification expired or was cancelled. Reopen Admin Protocol.')
            if attempt.busy or attempt.person_id or attempt.consumed:
                raise HTTPException(409, 'Face verification already started or completed')
            if request.headers.get('content-type', '').split(';')[0] not in {'image/jpeg', 'image/png'}:
                raise HTTPException(415, 'Send a JPEG or PNG image')
            attempt.busy = True
            try:
                result = await run_in_threadpool(self.recognizer.identify, await request.body(),
                                                 DEFAULT_VERIFY_THRESHOLD)
                faces = result['identified']
                if len(faces) != 1 or not faces[0]['matched'] or not faces[0]['is_admin']:
                    return {'verified': False}
                admin = await run_in_threadpool(self.admin, faces[0]['id'])
                self.check_attempt(attempt_id, attempt)
                if not admin:
                    return {'verified': False}
                attempt.person_id = admin['id']
                return {'verified': True, 'name': admin['name'], 'phrase': attempt.phrase}
            finally:
                attempt.busy = False

        @router.post('/attempts/{attempt_id}/voice')
        async def voice(attempt_id: str, request: Request):
            self.prune()
            attempt = self.attempts.get(attempt_id)
            if not attempt:
                raise HTTPException(410, 'Verification expired or was cancelled. Reopen Admin Protocol.')
            if not attempt.person_id or attempt.consumed:
                raise HTTPException(409, 'A fresh face verification is required')
            attempt.consumed = True
            try:
                result = await run_in_threadpool(
                    self.recognizer.verify_voice, await request.body(), attempt.person_id,
                    attempt.phrase, strict_challenge=True)
                admin = await run_in_threadpool(self.admin, attempt.person_id)
                self.check_attempt(attempt_id, attempt)
                words = re.findall(r'[a-z]+', result.get('transcribed_text', '').lower())
                if (not admin or result.get('target_id') != attempt.person_id
                        or not result.get('verified') or words != attempt.phrase.split()):
                    return {'verified': False, 'reason': 'Voice challenge failed. Reopen Admin Protocol to try again.'}
                credential = secrets.token_urlsafe(32)
                if self.on_verified:
                    self.on_verified()
                self.grants[credential] = Grant(time.monotonic() + GRANT_SECONDS, admin['id'], attempt_id)
                return {'verified': True, 'grant': credential, 'expires_in_seconds': GRANT_SECONDS,
                        'admin': {'id': admin['id'], 'name': admin['name'], 'permission': 'administrator'}}
            finally:
                self.attempts.pop(attempt_id, None)

        @router.delete('/attempts/{attempt_id}')
        async def cancel(attempt_id: str):
            self.attempts.pop(attempt_id, None)
            self.grants = {key: grant for key, grant in self.grants.items() if grant.attempt_id != attempt_id}
            return {'status': 'cancelled'}

        @router.delete('/grant')
        async def revoke(request: Request):
            self.grants.pop(request.headers.get('x-oracle-admin-grant', ''), None)
            return {'status': 'revoked'}

        return router
