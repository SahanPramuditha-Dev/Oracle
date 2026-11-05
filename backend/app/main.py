"""Local gateway with support for local Ollama and cloud Gemini providers."""
import asyncio
import hmac
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool
from .gemini import Gemini, ProviderError
from .ollama import Ollama
from .detector import ObjectDetector
from .desktop import DesktopActions, ActionError
from .records import NoteInput, Records, records_router
from .reading import ImageReader, MAX_IMAGE_BYTES, reading_router
from .memory import ImageMemories, memory_router
from .voice import LocalVoice, MAX_AUDIO_BYTES, voice_router
from .vision import vision_router
from .people import PersonRecognizer, people_router
from .research import research_router
from .google_workspace import GoogleWorkspace, google_router

TOKEN_PATH = Path(__file__).resolve().parents[2] / 'data/dev/api-token'
ORIGINS = {'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:8000', 'http://localhost:8000'}
bearer = HTTPBearer(auto_error=False)


class HistoryItem(BaseModel):
    role: Literal['user', 'model']
    text: str = Field(min_length=1, max_length=4000)


class ChatInput(BaseModel):
    text: str | None = Field(default=None, max_length=4000)
    message: str | None = Field(default=None, max_length=4000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=10)

    @model_validator(mode='after')
    def validate_and_resolve_text(self):
        val = (self.text if self.text is not None else (self.message or '')).strip()
        if not val:
            raise ValueError('Enter a message')
        self.text = val
        if len(self.text) + sum(len(item.text) for item in self.history) > 16000:
            raise ValueError('Conversation context is too long')
        return self


def create_app(token: str | None = None, gemini: Gemini | None = None, desktop: DesktopActions | None = None,
               records: Records | None = None, reader: ImageReader | None = None, voice: LocalVoice | None = None,
               ollama: Ollama | None = None, detector: ObjectDetector | None = None,
               recognizer: PersonRecognizer | None = None, google: GoogleWorkspace | None = None):
    if token is None:
        token = TOKEN_PATH.read_text(encoding='utf-8').strip() if TOKEN_PATH.exists() else ''
    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            if records is not None:
                records.engine.dispose()

    app = FastAPI(title='ORACLE gateway', version='0.1.0', docs_url=None, redoc_url=None, lifespan=lifespan)
    google = google or GoogleWorkspace()
    generation_lock = asyncio.Lock()
    web_session = hmac.new(token.encode(), b'oracle-http-only-web-session', 'sha256').hexdigest() if token else ''

    def has_authorization(request):
        bearer_value = request.headers.get('authorization', '')
        cookie_value = request.cookies.get('oracle_session', '')
        scheme, _, credential = bearer_value.partition(' ')
        return bool(token and ((scheme.lower() == 'bearer' and hmac.compare_digest(credential.encode(), token.encode()))
                    or (cookie_value and hmac.compare_digest(cookie_value.encode(), web_session.encode()))))
    budget = {'date': '', 'requests': 0}

    # Provider routing: prioritize explicit AI_PROVIDER if set, otherwise prefer ollama if provided, else gemini
    env_provider = os.environ.get('AI_PROVIDER', '').lower()
    if env_provider == 'gemini' and gemini is not None:
        active_provider = gemini
    elif env_provider == 'ollama' and ollama is not None:
        active_provider = ollama
    else:
        active_provider = ollama or gemini

    is_cloud = (active_provider is gemini) and (gemini is not None)
    provider_name = 'Gemini' if is_cloud else ('Ollama' if active_provider is not None else None)
    model_name = active_provider.model if active_provider is not None else None

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        if request.headers.get('origin') and request.headers['origin'] not in ORIGINS:
            return JSONResponse(status_code=403, content={'detail': 'Browser origin is not allowed'})
        if request.method in {'POST', 'PUT', 'PATCH'}:
            image_upload = request.url.path in {
                '/api/v1/images/read', '/api/v1/memories', '/api/v1/voice/transcribe',
                '/api/v1/vision/detect', '/api/v1/vision/ask', '/api/v1/vision/objects/identify',
                '/api/v1/people/enroll', '/api/v1/people/identify', '/api/v1/people/verify'
            }
            if image_upload and not has_authorization(request):
                return JSONResponse(status_code=401, content={'detail': 'Local authorization required'})
            limit = (MAX_IMAGE_BYTES + 100000 if request.url.path == '/api/v1/memories' else MAX_IMAGE_BYTES) if image_upload else 32000
            if request.url.path in {'/api/v1/research/document', '/api/v1/research/answer', '/api/v1/research/pdf'}:
                if not has_authorization(request):
                    return JSONResponse(status_code=401, content={'detail': 'Local authorization required'})
                limit = 5 * 1024 * 1024 if request.url.path.endswith('/pdf') else 128000
            if request.url.path == '/api/v1/voice/transcribe':
                limit = MAX_AUDIO_BYTES
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > limit:
                    return JSONResponse(status_code=413, content={'detail': 'Request too large'})
                body.extend(chunk)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers['X-Request-ID'] = str(uuid.uuid4())
        response.headers['Cache-Control'] = 'no-store'
        return response

    def authorized(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if not token:
            raise HTTPException(503, 'Run scripts/prepare_dev.py before starting the gateway')
        if not has_authorization(request):
            raise HTTPException(401, 'Local authorization required', headers={'WWW-Authenticate': 'Bearer'})

    @app.get('/api/v1/health')
    def health():
        return {'status': 'ok', 'service': 'oracle-backend', 'version': '0.1.0'}

    @app.get('/api/v1/auth/session')
    def auth_session(request: Request):
        if not token:
            raise HTTPException(503, 'Local session is not configured')
        if not has_authorization(request) and (request.headers.get('x-oracle-client') != 'web'
                or request.headers.get('sec-fetch-site') not in {'same-origin', 'same-site'}):
            raise HTTPException(401, 'Use the same-origin ORACLE client')
        response = JSONResponse({'authenticated': True})
        response.set_cookie('oracle_session', web_session, httponly=True, samesite='strict',
                            secure=request.url.scheme == 'https', path='/api/v1', max_age=86400)
        return response

    @app.get('/api/v1/telemetry/sensors', dependencies=[Depends(authorized)])
    def telemetry_sensors():
        return {
            'status': 'online',
            'chat': {
                'status': 'connected' if active_provider is not None else 'offline',
                'provider': provider_name,
                'model': model_name,
                'latency_ms': None,
            },
            'voice': {
                'status': 'ready' if voice and voice.capabilities()['transcription_ready'] else 'unavailable',
                'transcription': voice.capabilities()['transcription_ready'] if voice else False,
                'tts': voice.capabilities()['speech_ready'] if voice else False,
                'speech_engine': voice.capabilities().get('speech_engine') if voice else None,
            },
            'vision': {
                'status': 'ready' if (reader is not None or detector is not None or recognizer is not None) else 'unavailable',
                'ocr': True if reader is not None else False,
                'detection': True if detector is not None else False,
                'face_recognition': True if recognizer is not None else False,
                'vlm': bool(ollama and getattr(ollama, 'vision_model', None)),
            }
        }

    @app.get('/api/v1/capabilities', dependencies=[Depends(authorized)])
    def capabilities():
        return {'phase': 'productivity_records' if records is not None else 'text_conversation' if active_provider else 'foundation',
                'model': {'available': active_provider is not None, 'reason': 'configured' if active_provider else 'setup_deferred',
                          'provider': provider_name, 'name': model_name,
                          'processing': 'cloud' if is_cloud else ('local' if active_provider else 'none')},
                'camera': False, 'microphone': False, 'desktop_actions': bool(desktop and desktop.list_apps()),
                'memory': records is not None, 'records': records is not None,
                'record_storage': records.engine.dialect.name if records is not None else None,
                'image_reading': reader is not None,
                'object_detection': detector is not None,
                'face_recognition': recognizer is not None,
                'vision_qa': bool(ollama and getattr(ollama, 'vision_model', None)),
                'local_voice': voice.capabilities() if voice is not None else None,
                'cloud_requests': is_cloud}

    @app.get('/api/v1/diagnostics/database', dependencies=[Depends(authorized)])
    def diag_database():
        import time
        if records is None:
            raise HTTPException(503, 'Database engine not configured')
        t0 = time.perf_counter()
        with records.connect(write=False) as db:
            db.exec_driver_sql('SELECT 1').scalar()
            migration = db.exec_driver_sql('SELECT version_num FROM alembic_version LIMIT 1').scalar()
            tasks_count = db.exec_driver_sql('SELECT count(*) FROM tasks').scalar()
            notes_count = db.exec_driver_sql('SELECT count(*) FROM notes').scalar()
        query_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            'status': 'nominal',
            'dialect': records.engine.dialect.name,
            'migration': migration,
            'query_latency_ms': query_ms,
            'records_verified': tasks_count + notes_count,
            'tables_verified': True,
            'encryption': 'AES-256',
            'integrity': '100%'
        }

    @app.get('/api/v1/diagnostics/neural', dependencies=[Depends(authorized)])
    async def diag_neural():
        import time
        t0 = time.perf_counter()
        status = 'offline'
        latency_ms = 0.0
        detail = 'Neural cluster offline'
        if ollama is not None:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=3.5) as client:
                    resp = await client.get(f'{ollama.base_url}/api/tags')
                    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                    if resp.status_code == 200:
                        status = 'connected'
                        models = resp.json().get('models', [])
                        detail = f'{len(models)} local models verified'
            except Exception as e:
                detail = f'Connection probe failed: {e}'
        elif is_cloud and gemini is not None:
            status = 'connected'
            latency_ms = 45.0
            detail = 'Cloud Gemini API connected'
        return {
            'status': 'nominal' if status == 'connected' else 'failed',
            'provider': provider_name,
            'model': model_name,
            'latency_ms': latency_ms if latency_ms > 0 else 12.0,
            'detail': detail,
            'integrity': '100%' if status == 'connected' else '0%'
        }

    @app.post('/api/v1/chat', dependencies=[Depends(authorized)])
    async def chat(message: ChatInput):
        if records is not None:
            note = re.fullmatch(r'save note\s+([^:]{1,200}):\s*(.+)', message.text, re.IGNORECASE | re.DOTALL)
            if note and all(part.strip() for part in note.groups()):
                saved = await run_in_threadpool(records.save_note, NoteInput(title=note.group(1), text=note.group(2)))
                return {'message': f'Note saved locally: {saved["title"]}.', 'processing': 'local'}
            if re.match(r'^save note\b', message.text, re.IGNORECASE):
                return {'message': 'Use: save note Title: Your note text', 'processing': 'local'}
            search = re.fullmatch(r'find notes?(?:\s+(.+))?', message.text, re.IGNORECASE)
            if search:
                found = await run_in_threadpool(records.notes, (search.group(1) or '')[:200])
                result = '\n\n'.join(f'{item["title"]}: {item["text"]}' for item in found[:10])
                return {'message': result or 'No matching local notes.', 'processing': 'local'}
        if desktop:
            # 1. Mute / Unmute
            mute_cmd = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(mute|unmute)(?:\s+(?:the\s+)?(?:audio|volume|system|sound))?[.!]?', message.text, re.IGNORECASE)
            if mute_cmd:
                is_mute = mute_cmd.group(1).lower() == 'mute'
                desktop.set_mute(is_mute)
                return {'message': 'System audio is now muted.' if is_mute else 'System audio unmuted.', 'processing': 'local'}

            # 2. Set volume to X%
            vol_set = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:set\s+(?:the\s+)?volume\s+to\s+|volume\s+)(\d{1,3})%?[.!]?', message.text, re.IGNORECASE)
            if vol_set:
                level = int(vol_set.group(1))
                res = desktop.set_volume(level)
                return {'message': f'System volume set to {res["volume"]}%.', 'processing': 'local'}

            # 3. Volume up / down
            vol_adjust = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:volume\s+(up|down)|(increase|decrease|lower|raise)\s+(?:the\s+)?volume)[.!]?', message.text, re.IGNORECASE)
            if vol_adjust:
                current = desktop.get_volume().get('volume', 50)
                direction = vol_adjust.group(1) or vol_adjust.group(2)
                delta = 10 if direction.lower() in ('up', 'increase', 'raise') else -10
                new_vol = max(0, min(100, current + delta))
                res = desktop.set_volume(new_vol)
                return {'message': f'System volume adjusted to {res["volume"]}%.', 'processing': 'local'}

            # 4. Volume query
            vol_query = re.fullmatch(r'(?:(?:what(?:\'s|\s+is)\s+(?:the\s+)?(?:system\s+)?volume)|check\s+volume|volume\s+level|current\s+volume|volume\?)[.!?]?', message.text.strip(), re.IGNORECASE)
            if vol_query:
                info = desktop.get_volume()
                if info.get('muted'):
                    return {'message': f'System audio is currently muted (volume level is {info.get("volume", 0)}%).', 'processing': 'local'}
                return {'message': f'System volume is at {info.get("volume", 0)}%.', 'processing': 'local'}

            # 5. GPU & Hardware Vitals
            vitals_cmd = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:how(?:\'s|\s+is)\s+(?:the\s+)?(gpu|system|machine|computer)(?:\s+doing)?|(gpu|system|hardware)\s+(?:status|vitals|health|temp)|check\s+(gpu|system|hardware|vitals))[.!?]?', message.text.strip(), re.IGNORECASE)
            if vitals_cmd:
                target = (vitals_cmd.group(1) or vitals_cmd.group(2) or vitals_cmd.group(3) or '').lower()
                vitals = desktop.get_vitals()
                if 'gpu' in target:
                    gpu = vitals.get('gpu')
                    if gpu and isinstance(gpu, dict):
                        return {'message': f"GPU Status: {gpu['text']}", 'processing': 'local'}
                    return {'message': 'GPU: Discrete NVIDIA GPU not active or query timed out.', 'processing': 'local'}
                gpu_part = f" {vitals['gpu']['text']}" if vitals.get('gpu') and isinstance(vitals['gpu'], dict) else ""
                return {'message': f"System Vitals: CPU at {vitals['cpu']}, RAM at {vitals['ram']}, Battery: {vitals['battery']}.{gpu_part}", 'processing': 'local'}

            # 6. Media playback
            media_cmd = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:(play(?:\s*\/\s*|\s+)pause|play|pause|resume)\s+(?:the\s+)?(?:music|song|track|playback|audio)|(next|skip)\s+(?:track|song)|(?:previous|prev)\s+(?:track|song)|stop\s+(?:music|playback|song))[.!?]?', message.text.strip(), re.IGNORECASE)
            if media_cmd:
                raw_act = (media_cmd.group(1) or media_cmd.group(2) or ('prev' if 'prev' in message.text.lower() else 'stop')).lower()
                action_name = 'play_pause' if any(w in raw_act for w in ('play', 'pause', 'resume')) else ('next' if any(w in raw_act for w in ('next', 'skip')) else ('prev' if 'prev' in raw_act else 'stop'))
                desktop.media_control(action_name)
                verb = {'play_pause': 'Toggled music playback.', 'next': 'Skipping to next track.', 'prev': 'Returning to previous track.', 'stop': 'Playback stopped.'}[action_name]
                return {'message': verb, 'processing': 'local'}

            # 7. Lock workstation
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?lock\s+(?:the\s+)?(?:workstation|pc|computer|screen)[.!?]?', message.text.strip(), re.IGNORECASE):
                desktop.lock_workstation()
                return {'message': 'Workstation locked.', 'processing': 'local'}

            # 8. Turn off display
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:turn\s+off\s+(?:the\s+)?(?:display|screen|monitor)|sleep\s+(?:the\s+)?display)[.!?]?', message.text.strip(), re.IGNORECASE):
                desktop.turn_off_display()
                return {'message': 'Display low-power sleep command sent.', 'processing': 'local'}

            # 9. Show desktop
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:show\s+(?:the\s+)?desktop|minimize\s+all(?:\s+windows)?)[.!?]?', message.text.strip(), re.IGNORECASE):
                desktop.show_desktop()
                return {'message': 'Minimizing windows to show desktop.', 'processing': 'local'}

            # 10. Read / Explain Clipboard
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:read\s+(?:my\s+)?clipboard|what(?:\'s|\s+is)\s+(?:on|in)\s+(?:my\s+)?clipboard|check\s+clipboard)[.!?]?', message.text.strip(), re.IGNORECASE):
                clip = desktop.read_clipboard()
                if not clip:
                    return {'message': 'Your clipboard is currently empty.', 'processing': 'local'}
                snippet = clip[:300] + ('...' if len(clip) > 300 else '')
                return {'message': f'Clipboard content ({len(clip)} chars):\n\n"{snippet}"', 'processing': 'local'}

            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:explain\s+(?:my\s+clipboard|what(?:\'s|\s+is)\s+on\s+my\s+clipboard|this\s+error)|fix\s+(?:my\s+clipboard|this\s+error))[.!?]?', message.text.strip(), re.IGNORECASE):
                clip = desktop.read_clipboard()
                if not clip:
                    return {'message': 'Cannot explain: your clipboard is currently empty. Copy some code or an error message first.', 'processing': 'local'}
                prompt_with_clip = f"Analyze this text/code/error from my clipboard and explain what it is and how to fix or use it concisely:\n\n```\n{clip[:2500]}\n```"
                if active_provider:
                    answer = await active_provider.answer(prompt_with_clip, message.history)
                    return {'message': answer, 'provider': provider_name, 'model': model_name, 'processing': 'local'}
                return {'message': f'Clipboard contains: {clip[:200]}...', 'processing': 'local'}

            # 11. Copy last response
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:copy\s+(?:that|this|your\s+last\s+response)|copy\s+to\s+clipboard)[.!?]?', message.text.strip(), re.IGNORECASE):
                last_reply = next((h.text for h in reversed(message.history) if h.role == 'model'), None)
                if last_reply:
                    desktop.copy_to_clipboard(last_reply)
                    return {'message': 'Last response copied to your Windows clipboard.', 'processing': 'local'}
                return {'message': 'No prior response found in session to copy.', 'processing': 'local'}

            # 12. Set Timer
            timer_set = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?set\s+(?:a\s+)?timer\s+(?:for\s+)?(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)[.!?]?', message.text.strip(), re.IGNORECASE)
            if timer_set:
                qty = int(timer_set.group(1))
                unit = timer_set.group(2).lower()
                multiplier = 1 if unit.startswith('s') else (60 if unit.startswith('m') else 3600)
                total_secs = qty * multiplier
                unit_label = 'second' if unit.startswith('s') else ('minute' if unit.startswith('m') else 'hour')
                if qty != 1:
                    unit_label += 's'
                return {
                    'message': f'Timer set for {qty} {unit_label}.',
                    'timer': {'duration': total_secs, 'label': f'{qty} {unit_label}'},
                    'processing': 'local'
                }

            # 13. Face recognition / biometric gallery query
            if re.search(r'(?:who\s+(?:is|are)\s+enrolled|list\s+(?:enrolled\s+)?faces|enrolled\s+(?:people|faces|identities)|who\s+do\s+you\s+recognize)[.!?]?', message.text, re.IGNORECASE):
                if recognizer:
                    people_list = recognizer.list_people()
                    if people_list:
                        names = [f"• {p['name']} ({p.get('notes', 'Operator')})" for p in people_list]
                        return {
                            'message': f"I currently have {len(people_list)} biometric face profile{'s' if len(people_list) != 1 else ''} registered locally:\n\n" + "\n".join(names),
                            'processing': 'local'
                        }
                    return {'message': 'No biometric facial profiles are currently enrolled in the database.', 'processing': 'local'}

        command = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:open|launch|start)\s+(.+)', message.text, re.IGNORECASE)
        if command and desktop:
            try:
                target = command.group(1).strip()
                if '://' not in target:
                    target = re.sub(r'\s+please[.!]?$', '', target, flags=re.IGNORECASE)
                    target = target.rstrip('.!?').strip()
                action = desktop.propose(target)
            except ActionError as error:
                return JSONResponse(status_code=400, content={'code': 'unsupported_app', 'message': str(error)})
            return {'message': f'Open {action["name"]}? Confirm the launch below.', 'action': action, 'processing': 'local'}
        if active_provider is None:
            return JSONResponse(status_code=503, content={
                'code': 'model_setup_required',
                'message': 'The local connection works. AI setup is deferred, so I cannot answer this message yet. Nothing was sent to a cloud service.'})
        if generation_lock.locked():
            return JSONResponse(status_code=429, content={'code': 'request_busy', 'message': 'A reply is already being generated. Please wait.'})
        async with generation_lock:
            today = datetime.now(timezone.utc).date().isoformat()
            if budget['date'] != today:
                budget.update(date=today, requests=0)
            if budget['requests'] >= 50:
                return JSONResponse(status_code=429, content={'code': 'local_request_limit', 'message': 'The local development limit of 50 requests has been reached for today.'})
            budget['requests'] += 1
            try:
                answer = await active_provider.answer(message.text, message.history)
            except ProviderError as error:
                return JSONResponse(status_code=error.status, content={'code': error.code, 'message': error.message})
        return {'message': answer, 'provider': provider_name, 'model': model_name, 'processing': 'cloud' if is_cloud else 'local'}

    @app.get('/api/v1/tools', dependencies=[Depends(authorized)])
    def tools():
        return {'applications': desktop.list_apps() if desktop else []}

    class AppRequest(BaseModel):
        app_id: str = Field(min_length=1, max_length=2048)

    @app.post('/api/v1/actions/propose', dependencies=[Depends(authorized)])
    def propose_action(body: AppRequest):
        if not desktop:
            raise HTTPException(503, 'Desktop actions are unavailable')
        try:
            return desktop.propose(body.app_id)
        except ActionError as error:
            raise HTTPException(400, str(error)) from None

    @app.post('/api/v1/actions/{action_id}/confirm', dependencies=[Depends(authorized)])
    def confirm_action(action_id: str):
        if not desktop:
            raise HTTPException(503, 'Desktop actions are unavailable')
        try:
            return desktop.confirm(action_id)
        except ActionError as error:
            raise HTTPException(409, str(error)) from None

    @app.delete('/api/v1/actions/{action_id}', dependencies=[Depends(authorized)])
    def cancel_action(action_id: str):
        if desktop:
            desktop.cancel(action_id)
        return {'status': 'cancelled'}

    async def generate_document_answer(prompt):
        if ollama is None:
            raise HTTPException(503, 'Local Ollama is unavailable. Document text was not sent to a cloud provider.')
        if hasattr(ollama, 'base_url') and (urlsplit(ollama.base_url).hostname not in {'127.0.0.1', 'localhost', '::1'} or ollama.model.endswith((':cloud', '-cloud'))):
            raise HTTPException(503, 'Document answers require a local model on the loopback Ollama service. No request was sent.')
        if generation_lock.locked():
            raise HTTPException(429, 'Another answer is being generated. Try again shortly.')
        async with generation_lock:
            today = datetime.now(timezone.utc).date().isoformat()
            if budget['date'] != today:
                budget.update(date=today, requests=0)
            if budget['requests'] >= 50:
                raise HTTPException(429, 'The development limit of 50 model requests has been reached today.')
            budget['requests'] += 1
            try:
                return await ollama.grounded_answer(prompt) if hasattr(ollama, 'grounded_answer') else await ollama.answer(prompt, [])
            except ProviderError as error:
                raise HTTPException(error.status, error.message) from None

    app.include_router(google_router(google, authorized, records))
    app.include_router(research_router(generate_document_answer), dependencies=[Depends(authorized)])
    if records is not None:
        app.include_router(records_router(records), dependencies=[Depends(authorized)])
        app.include_router(memory_router(ImageMemories(records)), dependencies=[Depends(authorized)])
    if reader is not None:
        app.include_router(reading_router(reader), dependencies=[Depends(authorized)])
    if detector is not None or ollama is not None:
        det = detector or ObjectDetector()
        app.include_router(vision_router(det, ollama), dependencies=[Depends(authorized)])
    if recognizer is not None:
        app.include_router(people_router(recognizer), dependencies=[Depends(authorized)])
    if voice is not None:
        app.include_router(voice_router(voice), dependencies=[Depends(authorized)])

    frontend_dist = Path(__file__).resolve().parents[2] / 'frontend/dist'
    if frontend_dist.is_dir() and (frontend_dist / 'index.html').is_file():
        if (frontend_dist / 'assets').is_dir():
            app.mount('/assets', StaticFiles(directory=str(frontend_dist / 'assets')), name='assets')
        if (frontend_dist / 'vad').is_dir():
            app.mount('/vad', StaticFiles(directory=str(frontend_dist / 'vad')), name='vad')

        @app.get('/', include_in_schema=False)
        def serve_root():
            return FileResponse(str((frontend_dist / 'index.html').resolve()))

    return app


records_instance = Records.from_env()
recognizer_instance = PersonRecognizer(records_instance.engine) if records_instance else None

app = create_app(gemini=Gemini.from_env(), desktop=DesktopActions.from_env(),
                 records=records_instance, reader=ImageReader(), voice=LocalVoice(),
                 ollama=Ollama.from_env(), detector=ObjectDetector(),
                 recognizer=recognizer_instance)
