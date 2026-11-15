"""Local gateway with support for local Ollama and cloud Gemini providers."""
import asyncio
import hmac
import json
import os
import re
import uuid
from contextlib import aclosing, asynccontextmanager, nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool
from .tls import verified_tls
from .live_answers import (
    CALENDAR_QUESTION, CALENDAR_TOMORROW, DEPARTURE_QUESTION, MEETING_LOCATION, NEXT_REMINDER,
    REMINDER_QUESTION, ROUTE_QUESTION, TIMER_QUESTION, correct_question, live_answer, lookup_city,
    normalize_question, resolve_follow_up,
)
from .behavior import ReplyPreferences
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
from .admin_protocol import AdminProtocol
from .research import research_router
from .google_workspace import GoogleWorkspace, google_router
from .geo import geo_router
from .product_intelligence import ProductKnowledgeService, product_router

TOKEN_PATH = Path(__file__).resolve().parents[2] / 'data/dev/api-token'
ORIGINS = {
    'http://127.0.0.1:5173', 'http://localhost:5173',
    'http://127.0.0.1:3000', 'http://localhost:3000',
    'http://127.0.0.1:8000', 'http://localhost:8000'
}
bearer = HTTPBearer(auto_error=False)


class HistoryItem(BaseModel):
    role: Literal['user', 'model']
    text: str = Field(min_length=1, max_length=4000)


class ChatInput(BaseModel):
    text: str | None = Field(default=None, max_length=4000)
    message: str | None = Field(default=None, max_length=4000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=10)
    reply_preferences: ReplyPreferences | None = None
    weather_city: str | None = Field(default=None, min_length=1, max_length=100)
    route_origin: tuple[float, float] | None = None

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
    from .companion_settings import CompanionSettings
    companion = CompanionSettings()

    @asynccontextmanager
    async def lifespan(app):
        try:
            async with ollama.lifespan() if isinstance(ollama, Ollama) else nullcontext():
                await run_in_threadpool(companion.restore)
                yield
        finally:
            await run_in_threadpool(companion.close)
            if records is not None:
                records.engine.dispose()

    app = FastAPI(title='ORACLE gateway', version='0.1.0', docs_url=None, redoc_url=None, lifespan=lifespan)
    google = google or GoogleWorkspace()
    lockdown_result = None
    lockdown_lock = asyncio.Lock()

    def recover_from_lockdown():
        nonlocal lockdown_result
        if lockdown_result is not None:
            if desktop is not None:
                desktop.resume()
            lockdown_result = None

    admin_protocol = AdminProtocol(recognizer, recover_from_lockdown)
    generation_lock = asyncio.Lock()
    web_session = hmac.new(token.encode(), b'oracle-http-only-web-session', 'sha256').hexdigest() if token else ''

    def has_bearer_authorization(request):
        bearer_value = request.headers.get('authorization', '')
        scheme, _, credential = bearer_value.partition(' ')
        return bool(token and scheme.lower() == 'bearer' and hmac.compare_digest(credential.encode(), token.encode()))

    def has_authorization(request):
        cookie_value = request.cookies.get('oracle_session', '')
        return has_bearer_authorization(request) or bool(
            token and cookie_value and hmac.compare_digest(cookie_value.encode(), web_session.encode()))
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
    def model_name():
        return active_provider.model if active_provider is not None else None

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        if request.headers.get('origin') and request.headers['origin'] not in ORIGINS:
            return JSONResponse(status_code=403, content={'detail': 'Browser origin is not allowed'})
        if request.method in {'POST', 'PUT', 'PATCH'}:
            admin_attempt = request.url.path.startswith('/api/v1/admin/attempts/')
            is_voice_audio = (
                request.url.path == '/api/v1/voice/transcribe'
                or (admin_attempt and request.url.path.endswith('/voice'))
                or '/voice/' in request.url.path
                or request.url.path.endswith('/voice/verify')
                or request.url.path.endswith('/voice/enroll')
            )
            image_upload = (
                request.url.path in {
                    '/api/v1/images/read', '/api/v1/images/qr', '/api/v1/memories', '/api/v1/voice/transcribe',
                    '/api/v1/vision/detect', '/api/v1/vision/ask', '/api/v1/vision/objects/identify',
                    '/api/v1/people/enroll', '/api/v1/people/identify', '/api/v1/people/verify',
                    '/api/v1/people/voice/verify', '/api/v1/vision/products/inspect'
                }
                or is_voice_audio
                or (admin_attempt and request.url.path.endswith('/face'))
            )
            if image_upload and not has_authorization(request):
                return JSONResponse(status_code=401, content={'detail': 'Local authorization required'})
            if is_voice_audio:
                limit = MAX_AUDIO_BYTES
            elif request.url.path == '/api/v1/memories':
                limit = MAX_IMAGE_BYTES + 100000
            elif image_upload:
                limit = MAX_IMAGE_BYTES
            elif request.url.path in {'/api/v1/research/document', '/api/v1/research/answer', '/api/v1/research/pdf'}:
                if not has_authorization(request):
                    return JSONResponse(status_code=401, content={'detail': 'Local authorization required'})
                limit = 5 * 1024 * 1024 if request.url.path.endswith('/pdf') else 128000
            else:
                limit = 32000
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > limit:
                    return JSONResponse(status_code=413, content={'detail': 'Request too large'})
                body.extend(chunk)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers['X-Request-ID'] = str(uuid.uuid4())
        if response.status_code in {200, 206, 304} and re.fullmatch(
            r'/assets/[^/]+-[\w-]{8}\.(?:css|m?js|wasm|woff2?)', request.url.path
        ):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        else:
            response.headers['Cache-Control'] = 'no-store'
        return response

    def authorized(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if not token:
            raise HTTPException(503, 'Run scripts/prepare_dev.py before starting the gateway')
        if not has_authorization(request):
            raise HTTPException(401, 'Local authorization required', headers={'WWW-Authenticate': 'Bearer'})

    async def protect_identity(request, person_id, permission):
        # The explicit local maintenance credential can provision or recover an administrator.
        if has_bearer_authorization(request):
            return
        identities = await run_in_threadpool(recognizer.list_people)
        if permission == 'administrator' or any(
            p['id'] == person_id and p['permission'] == 'administrator' for p in identities
        ):
            await admin_protocol.require(request)

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
                'model': model_name(),
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
                          'provider': provider_name, 'name': model_name(),
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

    class OllamaModelInput(BaseModel):
        model: str = Field(min_length=1, max_length=200, pattern=r'^[a-zA-Z0-9_.:-]+$')

    @app.get('/api/v1/models/ollama', dependencies=[Depends(authorized)])
    async def list_ollama_models():
        if ollama is None:
            raise HTTPException(503, 'Ollama is unavailable')
        models = []
        for item in await ollama.list_models():
            name = item.get('name')
            if not name:
                continue
            features = item.get('capabilities') or []
            details = item.get('details') or {}
            models.append({'value': name, 'label': name,
                           'badge': 'THINKING' if 'thinking' in features else 'TOOLS' if 'tools' in features else None,
                           'desc': details.get('parameter_size')})
        return {'active': ollama.model, 'models': models}

    @app.post('/api/v1/models/ollama', dependencies=[Depends(authorized)])
    async def select_ollama_model(body: OllamaModelInput):
        if ollama is None:
            raise HTTPException(503, 'Ollama is unavailable')
        if body.model not in {item.get('name') for item in await ollama.list_models()}:
            raise HTTPException(404, 'Ollama model is not installed')
        if generation_lock.locked():
            raise HTTPException(409, 'Wait for the current reply before changing the model')
        async with generation_lock:
            await run_in_threadpool(ollama.update_model, body.model)
        return {'active': ollama.model}

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
            'tables_verified': ['tasks', 'notes']
        }

    @app.get('/api/v1/diagnostics/neural', dependencies=[Depends(authorized)])
    async def diag_neural():
        import time
        t0 = time.perf_counter()
        status = 'failed'
        latency_ms = None
        detail = 'No AI provider configured'
        if is_cloud:
            status = 'unverified'
            detail = 'Gemini configured. No cloud request was made.'
        elif ollama is not None:
            detail = 'Ollama is unavailable'
            try:
                import httpx
                async with httpx.AsyncClient(timeout=3.5, verify=verified_tls()) as client:
                    response = await client.get(f'{ollama.base_url}/api/tags')
                    response.raise_for_status()
                models = response.json()['models']
                latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                if any(ollama.model in (item.get('name'), item.get('model')) for item in models):
                    status = 'nominal'
                    detail = 'Configured model listed by Ollama'
                else:
                    detail = 'Ollama responded but did not list the configured model'
            except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
                pass
        return {
            'status': status,
            'provider': provider_name,
            'model': model_name(),
            'latency_ms': latency_ms,
            'detail': detail,
        }

    atlas = geo_router(records)
    atlas_route = next(route.endpoint for route in atlas.routes if route.name == 'get_route')
    atlas_search = next(route.endpoint for route in atlas.routes if route.name == 'search_places')

    @app.post('/api/v1/chat', dependencies=[Depends(authorized)])
    async def chat(message: ChatInput, stream: bool = False):
        previous_question = next((item.text for item in reversed(message.history) if item.role == 'user'), None)
        resolved = resolve_follow_up(message.text, previous_question)
        answer = await run_in_threadpool(live_answer, resolved, message.weather_city)
        if answer is not None:
            return {'message': answer, 'processing': 'local'}
        query = normalize_question(correct_question(resolved))
        if TIMER_QUESTION.fullmatch(query):
            answer = 'Oracle’s timer store is unavailable.'
            if records is not None:
                now_ms = records.now()
                timers = []
                for item in await run_in_threadpool(records.tasks):
                    if item['kind'] == 'timer' and item['due'] > now_ms:
                        seconds = (item['due'] - now_ms + 999) // 1000
                        hours, remainder = divmod(seconds, 3600)
                        minutes, seconds = divmod(remainder, 60)
                        remaining = f'{hours}:{minutes:02d}:{seconds:02d}' if hours else f'{minutes}:{seconds:02d}'
                        timers.append(f"{item['title']} — {remaining} remaining")
                answer = '\n'.join(timers) or 'You have no active timers.'
            return {'message': answer, 'processing': 'local'}
        tomorrow = bool(CALENDAR_TOMORROW.fullmatch(query))
        departure = bool(DEPARTURE_QUESTION.fullmatch(query))
        meeting_location = bool(MEETING_LOCATION.fullmatch(query))
        if tomorrow or departure or meeting_location or CALENDAR_QUESTION.fullmatch(query):
            now = datetime.now(timezone.utc)
            origin = message.route_origin
            if departure and (not origin or not (-90 <= origin[0] <= 90 and -180 <= origin[1] <= 180)):
                return {'message': 'Share your location in Oracle Central to calculate when to leave.', 'processing': 'local'}
            tomorrow_date = now.astimezone().date() + timedelta(days=1)
            start_of_tomorrow = datetime.combine(tomorrow_date, datetime.min.time()).astimezone()
            end_of_tomorrow = datetime.combine(tomorrow_date + timedelta(days=1), datetime.min.time()).astimezone()
            try:
                events = await google.api('GET', 'calendars/primary/events', params={
                    'timeMin': (start_of_tomorrow if tomorrow else now).isoformat(),
                    'timeMax': (end_of_tomorrow if tomorrow else now + timedelta(days=60)).isoformat(),
                    'singleEvents': 'true', 'orderBy': 'startTime', 'maxResults': 100,
                })
                answer = 'I found no upcoming timed events in your primary calendar in the next 60 days.'
                agenda = []
                for event in events.get('items', []):
                    if event.get('status') == 'cancelled':
                        continue
                    title = event.get('summary') or 'Untitled event'
                    start = event.get('start', {}).get('dateTime')
                    if tomorrow:
                        if start:
                            when = datetime.fromisoformat(start).astimezone()
                            label = f'{when:%I:%M %p}' if when.date() == tomorrow_date else 'In progress at midnight'
                        else:
                            label = 'All day'
                        agenda.append(f'{label} — {title}')
                        continue
                    if not start:
                        continue
                    starts_at = datetime.fromisoformat(start)
                    if starts_at >= now:
                        answer = f"Your next calendar event is {title} on {starts_at.astimezone():%A, %B %d at %I:%M %p} (Oracle Central local time)."
                        if meeting_location:
                            address = (event.get('location') or '').strip()
                            answer = f'The location listed for {title} is {address}.' if address else f'{title} has no location listed.'
                        if departure:
                            address = (event.get('location') or '').strip()
                            answer = f'Add a physical location to {title} in Google Calendar to get a departure estimate.'
                            if address and len(address) <= 150 and not address.lower().startswith(('http:', 'https:')):
                                places = await atlas_search(q=address, lat=origin[0], lon=origin[1], limit=1, language='en', sri_lanka=False)
                                if places.get('results'):
                                    place = places['results'][0]
                                    route = await atlas_route(*origin, place['lat'], place['lon'], mode='driving',
                                                              stop=[], optimize=False, traffic=False, arrive_by=None)
                                    if route['status'] == 'success':
                                        minutes = max(1, int(-(-route['duration_seconds'] // 60)))
                                        leave = starts_at - timedelta(minutes=minutes + 10)
                                        current_time = datetime.now(timezone.utc)
                                        if current_time + timedelta(minutes=minutes) > starts_at:
                                            timing = 'Leave now, but you may arrive late'
                                        elif leave <= current_time:
                                            timing = 'Leave now'
                                        else:
                                            timing = f'Leave by {leave.astimezone():%A, %B %d at %I:%M %p}'
                                        answer = f"{timing} for {title} at {place['display_name']}. Allow about {minutes} minutes for driving plus a 10-minute buffer. This estimate uses Oracle Central’s local time and excludes live traffic."
                                    else:
                                        answer = f'I couldn’t find a driving route for {title}.'
                                else:
                                    answer = f'I couldn’t locate the calendar address for {title}.'
                        break
                if tomorrow:
                    answer = '\n'.join(agenda[:20]) or 'You have no events tomorrow on your primary calendar.'
                    if len(agenda) > 20 or events.get('nextPageToken'):
                        answer += '\nMore events are available in Google Calendar.'
                elif answer.startswith('I found no') and events.get('nextPageToken'):
                    answer = 'I couldn’t confirm your next timed event from the calendar results.'
            except HTTPException as exc:
                answer = 'Connect Google Calendar in Oracle Central to see your next meeting.' if exc.status_code in (401, 403) else 'I couldn’t retrieve your calendar right now.'
            except (OSError, ValueError, TypeError, AttributeError, KeyError, OverflowError):
                answer = 'I couldn’t read the calendar or routing data.'
            return {'message': answer, 'processing': 'local'}
        next_reminder = bool(NEXT_REMINDER.fullmatch(query))
        if next_reminder or REMINDER_QUESTION.fullmatch(query):
            answer = 'Oracle’s reminder store is unavailable.'
            if records is not None:
                today = datetime.now().date()
                reminders = []
                for item in await run_in_threadpool(records.tasks):
                    if item['kind'] != 'reminder':
                        continue
                    due = datetime.fromtimestamp(item['due'] / 1000)
                    if next_reminder and item['state'] == 'pending':
                        reminders.append(f"Your next reminder is {item['title']} on {due:%A, %B %d at %I:%M %p} (Oracle Central local time).")
                        break
                    if not next_reminder and due.date() == today:
                        reminders.append(f"{due:%I:%M %p} — {item['title']}")
                answer = '\n'.join(reminders) or ('You have no upcoming reminders.' if next_reminder else 'You have no saved reminders for today.')
            return {'message': answer, 'processing': 'local'}
        if match := ROUTE_QUESTION.fullmatch(query):
            origin = message.route_origin
            answer = 'Share your location with Oracle Central to get a driving distance and travel time.'
            if origin and -90 <= origin[0] <= 90 and -180 <= origin[1] <= 180:
                try:
                    location = await run_in_threadpool(lookup_city, match[1])
                    if not location:
                        answer = f'I couldn’t find {match[1]}. Try a nearby city.'
                    else:
                        route = await atlas_route(*origin, location['latitude'], location['longitude'],
                                                  mode='driving', stop=[], optimize=False, traffic=False, arrive_by=None)
                        if route['status'] == 'success':
                            minutes = max(1, round(route['duration_seconds'] / 60))
                            answer = f"Driving to {location['name']} is {route['distance_meters'] / 1000:.1f} km and takes about {minutes} minutes, based on the route estimate."
                        else:
                            answer = 'I couldn’t find a driving route to that city.'
                except (OSError, ValueError, TypeError, KeyError, HTTPException):
                    answer = 'I couldn’t retrieve a driving estimate right now.'
            return {'message': answer, 'processing': 'local'}
        reply_options = {'reply_preferences': message.reply_preferences} if message.reply_preferences is not None else {}
        if re.fullmatch(r"what can you do[?!.]*", message.text.strip(), re.IGNORECASE):
            suggestions = ['research']
            descriptions = ['search and summarize research']
            if records is not None:
                suggestions.append('records')
                descriptions.append('manage notes and tasks')
            if ollama and getattr(ollama, 'vision_model', None):
                suggestions.append('image')
                descriptions.append('answer questions about images')
            return {'message': 'I can ' + ', '.join(descriptions) + '.', 'suggestions': suggestions,
                    'processing': 'local'}
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
                # System Protocols
        admin_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:activate|activated|select|selected|engage|initiate|start|run|open|trigger)?\s*(?:the\s+)?(?:protocol\s+admin|admin\s+protocol|admin))[.!?]?', message.text.strip(), re.IGNORECASE)
        if admin_proto_cmd:
            return {
                'message': 'Admin protocol initiated. Engaging optical camera to scan and identify administrator biometrics.',
                'action_trigger': 'open_admin_protocol',
                'processing': 'local'
            }

        sentinel_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:activate|activated|select|selected|engage|initiate|start|run|open|trigger)?\s*(?:the\s+)?(?:protocol\s+sentinel|sentinel\s+protocol|sentinel|protocol\s+sentry|sentry\s+protocol|sentry\s+mode))[.!?]?', message.text.strip(), re.IGNORECASE)
        if sentinel_proto_cmd:
            is_sentry = 'sentry' in message.text.lower()
            return {
                'message': 'Sentry protocol initiated. Camera access requested.' if is_sentry else 'Sentinel status view requested.',
                'action_trigger': 'activate_sentry' if is_sentry else 'activate_sentinel',
                'processing': 'local'
            }

        ghost_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:activate|activated|engage|initiate|start|run|enter|toggle)?\s*(?:the\s+)?(?:protocol\s+ghost|ghost\s+protocol|ghost|privacy\s+mode))[.!?]?', message.text.strip(), re.IGNORECASE)
        if ghost_proto_cmd:
            return {
                'message': 'Ghost protocol activation requested.',
                'action_trigger': 'activate_ghost',
                'processing': 'local'
            }

        focus_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:initiate|activate|start|begin|enter)?\s*(?:the\s+)?(?:protocol\s+focus|focus\s+protocol|focus|deep\s+work(?:\s+mode)?))[.!?]?', message.text.strip(), re.IGNORECASE)
        if focus_proto_cmd:
            return {
                'message': 'Protocol Focus initiated. Development workspace open, non-essential notifications silenced, 25-minute cadence queued.',
                'action_trigger': 'activate_focus',
                'processing': 'local'
            }

        diag_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:run|start|open|launch|execute|begin|perform)?\s*(?:a\s+)?(?:system\s+)?(?:full\s+diagnostics?|self\s*[- ]?diagnostic|diagnostics|diagnostic\s+checks?|subsystem\s+diagnostics?|protocol\s+diagnostic|diagnostic\s+protocol))[s]?[.!?]?', message.text.strip(), re.IGNORECASE)
        if diag_cmd:
            return {
                'message': 'Initiating full subsystem self-diagnostic protocol. Probing neural gateway, database, acoustic, and optical sensors.',
                'action_trigger': 'open_self_diagnostic',
                'processing': 'local'
            }

        command_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:activate|open|launch|start|engage)?\s*(?:the\s+)?(?:protocol\s+command|command\s+protocol|command|desktop\s+control))[.!?]?', message.text.strip(), re.IGNORECASE)
        if command_proto_cmd:
            return {
                'message': 'Protocol Command active. Desktop Active HUD displayed for window management and application control.',
                'action_trigger': 'open_desktop_hud',
                'processing': 'local'
            }

        atlas_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:activate|open|show|launch|start|engage|view)?\s*(?:the\s+)?(?:tactical\s+)?(?:geo\s+)?(?:protocol\s+atlas|atlas\s+protocol|atlas|spatial\s+intelligence|map|maps))[.!?]?', message.text.strip(), re.IGNORECASE)
        ambiguous_open = re.fullmatch(
            r'(?:(?:(?:hey|hi|ok|okay)\s+)?oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?'
            r'(?:open|show|launch|view|activate|enter)(?:\s+(?:it|at|mat|up|that|this))?[.!?]?',
            message.text.strip(), re.IGNORECASE
        )
        if ambiguous_open:
            return {'message': 'What would you like me to open?', 'processing': 'local'}
        if atlas_proto_cmd:
            return {
                'message': 'Protocol Atlas active. Launching Spatial Intelligence Geospatial HUD.',
                'action_trigger': 'activate_atlas',
                'processing': 'local'
            }

        watchtower_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:activate|open|launch|start|engage)?\s*(?:the\s+)?(?:protocol\s+watchtower|watchtower\s+protocol|watchtower|network\s+awareness))[.!?]?', message.text.strip(), re.IGNORECASE)
        if watchtower_proto_cmd:
            return {
                'message': 'Protocol Watchtower active. Network awareness and infrastructure diagnostics online.',
                'action_trigger': 'activate_watchtower',
                'processing': 'local'
            }

        briefing_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:initiate|start|run|play|give\s+me)?\s*(?:the\s+)?(?:morning\s+briefing|daily\s+briefing|protocol\s+briefing|briefing\s+protocol|briefing))[.!?]?', message.text.strip(), re.IGNORECASE)
        if briefing_proto_cmd:
            return {
                'message': 'Protocol Briefing initiated. Compiling calendar agenda, pending tasks, and local conditions.',
                'action_trigger': 'activate_briefing',
                'processing': 'local'
            }

        hibernate_proto_cmd = re.fullmatch(r'(?:(?:hey\s+|oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:initiate|activate|enter|start)?\s*(?:the\s+)?(?:protocol\s+hibernate|hibernate\s+protocol|hibernate|low\s+activity))[.!?]?', message.text.strip(), re.IGNORECASE)
        if hibernate_proto_cmd:
            return {
                'message': 'Protocol Hibernate requested.',
                'action_trigger': 'activate_hibernate',
                'processing': 'local'
            }

        lockdown_proto_cmd = re.fullmatch(r'(?:(?:(?:hey|ok|okay)\s+)?oracle[,\s]+|hey\s+)?(?:please\s+|(?:can|could)\s+you\s+)?(?:(?:activate|activated|select|selected|engage|initiate|start|run|open|trigger)\s+)?(?:the\s+)?(?:protocol\s+lockdown|lockdown\s+protocol|lockdown|emergency\s+restriction)[.!?]?', message.text.strip(), re.IGNORECASE)
        if lockdown_proto_cmd:
            return {
                'message': 'Lockdown activation requested.',
                'action_trigger': 'activate_lockdown',
                'processing': 'local'
            }

        if admin_protocol.lockdown_pending or lockdown_result is not None:
            return {'message': 'Oracle is restricted by Lockdown. Verify with Admin Protocol to resume.',
                    'processing': 'local'}

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
                try:
                    outcome = desktop.lock_workstation()
                except ActionError as error:
                    return {'message': str(error), 'processing': 'local'}
                return {'message': outcome['message'], 'processing': 'local'}

            # 8. Turn off display
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:turn\s+off\s+(?:the\s+)?(?:display|screen|monitor)|sleep\s+(?:the\s+)?display)[.!?]?', message.text.strip(), re.IGNORECASE):
                desktop.turn_off_display()
                return {'message': 'Display low-power sleep command sent.', 'processing': 'local'}

            # 8b. Sleep / Hibernate / Stay Awake
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:sleep(?:\s+the)?\s+(?:pc|computer)|put(?:\s+the)?\s+(?:pc|computer)\s+to\s+sleep)[.!?]?', message.text.strip(), re.IGNORECASE):
                try:
                    desktop.sleep_pc()
                    return {'message': 'Windows sleep command accepted. PC is entering sleep state.', 'processing': 'local'}
                except ActionError as error:
                    return {'message': str(error), 'processing': 'local'}

            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:hibernate(?:\s+the)?\s+(?:pc|computer))[.!?]?', message.text.strip(), re.IGNORECASE):
                try:
                    desktop.hibernate_pc()
                    return {'message': 'Windows hibernation initiated.', 'processing': 'local'}
                except ActionError as error:
                    return {'message': str(error), 'processing': 'local'}

            stay_m = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:stay\s+awake|keep(?:\s+the)?\s+(?:pc|computer)\s+awake)(?:\s+for\s+(\d+)\s*(minutes?|hours?))?[.!?]?', message.text.strip(), re.IGNORECASE)
            if stay_m:
                qty = int(stay_m.group(1)) if stay_m.group(1) else 60
                unit = stay_m.group(2) if stay_m.group(2) else 'minutes'
                mins = qty * 60 if 'hour' in unit else qty
                try:
                    desktop.stay_awake(mins)
                    return {'message': f'Stay-awake mode activated for {qty} {unit}.', 'processing': 'local'}
                except ActionError as error:
                    return {'message': str(error), 'processing': 'local'}

            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:cancel\s+stay\s+awake|allow\s+sleep|disable\s+stay\s+awake)[.!?]?', message.text.strip(), re.IGNORECASE):
                try:
                    desktop.cancel_stay_awake()
                    return {'message': 'Stay-awake mode cancelled. Normal Windows sleep policy restored.', 'processing': 'local'}
                except ActionError as error:
                    return {'message': str(error), 'processing': 'local'}

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
                    answer = await active_provider.answer(prompt_with_clip, message.history, **reply_options)
                    return {'message': answer, 'provider': provider_name, 'model': model_name(), 'processing': 'local'}
                return {'message': f'Clipboard contains: {clip[:200]}...', 'processing': 'local'}

            # 11. Copy last response
            if re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:copy\s+(?:that|this|your\s+last\s+response)|copy\s+to\s+clipboard)[.!?]?', message.text.strip(), re.IGNORECASE):
                last_reply = next((h.text for h in reversed(message.history) if h.role == 'model'), None)
                if last_reply:
                    desktop.copy_to_clipboard(last_reply)
                    return {'message': 'Last response copied to your Windows clipboard.', 'processing': 'local'}
                return {'message': 'No prior response found in session to copy.', 'processing': 'local'}

            # 12. Query active / open windows & desktop workspace
            desktop_pattern = r'\b(?:(?:what(?:\'s|\s+is|\s+are)?\s+(?:the\s+)?(?:currently\s+)?(?:running|open|active)\s+(?:applications|apps|programs|windows|tasks))|(?:what\s+am\s+i\s+working\s+on)|(?:what(?:\'s|\s+is)\s+(?:currently\s+)?working\s+on)|(?:show|list|display|get)\s+(?:my\s+)?(?:all\s+)?(?:open|running|active)\s+(?:windows|apps|applications|programs|tasks)|(?:running\s+(?:apps|applications|programs))|(?:open\s+(?:windows|apps|applications))|(?:desktop\s+(?:tasks|hud|windows)))\b'
            if re.search(desktop_pattern, message.text.strip(), re.IGNORECASE):
                windows = desktop.list_open_windows()
                if not windows:
                    return {'message': 'No active desktop applications detected.', 'processing': 'local', 'action_trigger': 'open_desktop_hud'}
                lines = [f"You currently have {len(windows)} active applications running:"]
                for w in windows[:6]:
                    status = " (Focused)" if w.get('is_active') else ""
                    lines.append(f"• {w['app_name']}: {w['title'][:55]}{status}")
                return {
                    'message': '\n'.join(lines),
                    'processing': 'local',
                    'action_trigger': 'open_desktop_hud',
                    'windows': windows
                }

            # 13. Switch to / Focus application
            switch_match = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:switch\s+to|focus|bring\s+up|activate)\s+([a-zA-Z0-9_\-\s]{2,40})[.!?]?', message.text.strip(), re.IGNORECASE)
            if switch_match:
                target_app = switch_match.group(1).lower().replace(' ', '')
                windows = desktop.list_open_windows()
                for w in windows:
                    if target_app in w['process'].lower() or target_app in w['app_name'].lower().replace(' ', '') or target_app in w['title'].lower().replace(' ', ''):
                        desktop.focus_window(w['hwnd'])
                        return {'message': f"Switched focus to {w['app_name']}: {w['title'][:50]}.", 'processing': 'local'}

            # 14. Set Timer
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

        pet_command = re.fullmatch(
            r'(?:(?:(?:hey|hi|ok|okay)\s+)?oracle[,\s]+)?(?:please\s+|(?:can|could)\s+you\s+)?'
            r'(?:open|launch|start|run)\s+(?:the\s+)?(?:oracle\s+pet|desktop\s+pet|pet)[.!?]?',
            message.text.strip(), re.IGNORECASE,
        )
        if pet_command:
            if not desktop:
                return {'message': 'Oracle Pet launch is unavailable on this gateway.', 'processing': 'local'}
            try:
                action = desktop.propose('oracle-pet')
            except ActionError as error:
                return {'message': f'Cannot open Oracle Pet: {error}', 'processing': 'local'}
            return {'message': 'Open Oracle Pet? Confirm the launch below.', 'action': action, 'processing': 'local'}

        command = re.fullmatch(r'(?:please\s+|(?:can|could)\s+you\s+)?(?:open|launch|start)\s+(.+)', message.text, re.IGNORECASE)
        if command and desktop:
            try:
                target = command.group(1).strip()
                if '://' not in target:
                    target = re.sub(r'\s+please[.!]?$', '', target, flags=re.IGNORECASE)
                    target = target.rstrip('.!?').strip()
                action = desktop.propose(target)
            except ActionError as error:
                return {'message': f'Cannot open application: {error}', 'processing': 'local'}
            return {'message': f'Open {action["name"]}? Confirm the launch below.', 'action': action, 'processing': 'local'}
        if active_provider is None:
            return JSONResponse(status_code=503, content={
                'code': 'model_setup_required',
                'message': 'The local connection works. AI setup is deferred, so I cannot answer this message yet. Nothing was sent to a cloud service.'})
        def reserve_reply():
            today = datetime.now(timezone.utc).date().isoformat()
            if budget['date'] != today:
                budget.update(date=today, requests=0)
            if budget['requests'] >= 50:
                return False
            budget['requests'] += 1
            return True

        busy = 'A reply is already being generated. Please wait.'
        limit = 'The local development limit of 50 requests has been reached for today.'
        if generation_lock.locked():
            return JSONResponse(status_code=429, content={'code': 'request_busy', 'message': busy})

        if stream and not is_cloud and hasattr(active_provider, 'answer_stream'):
            async def reply_events():
                if generation_lock.locked():
                    yield json.dumps({'error': busy}) + '\n'
                    return
                async with generation_lock:
                    if not reserve_reply():
                        yield json.dumps({'error': limit}) + '\n'
                        return
                    try:
                        async with aclosing(active_provider.answer_stream(message.text, message.history, **reply_options)) as tokens:
                            async for delta in tokens:
                                yield json.dumps({'delta': delta}) + '\n'
                    except ProviderError as error:
                        yield json.dumps({'error': error.message}) + '\n'
                        return
                    yield json.dumps({'done': True, 'provider': provider_name, 'model': model_name(),
                                      'processing': 'local'}) + '\n'
            return StreamingResponse(reply_events(), media_type='application/x-ndjson')

        async with generation_lock:
            if not reserve_reply():
                return JSONResponse(status_code=429, content={'code': 'local_request_limit', 'message': limit})
            try:
                answer = await active_provider.answer(message.text, message.history, **reply_options)
            except ProviderError as error:
                return JSONResponse(status_code=error.status, content={'code': error.code, 'message': error.message})
        return {'message': answer, 'provider': provider_name, 'model': model_name(), 'processing': 'cloud' if is_cloud else 'local'}

    @app.get('/api/v1/tools', dependencies=[Depends(authorized)])
    def tools():
        return {'applications': desktop.list_apps() if desktop else []}

    @app.post('/api/v1/protocols/lockdown', dependencies=[Depends(authorized)])
    async def activate_lockdown():
        nonlocal lockdown_result
        async with lockdown_lock:
            if lockdown_result is not None:
                return {**lockdown_result, 'already_active': True}
            admin_protocol.lockdown_pending = True
            admin_protocol.revoke_all()
            try:
                cancelled = desktop.restrict() if desktop is not None else 0
                # Record the restriction before requesting the asynchronous Windows operation.
                lockdown_result = {'oracle': 'restricted', 'windows': 'unavailable',
                                   'cancelled_actions': cancelled, 'already_active': False}
                if desktop is not None:
                    try:
                        await run_in_threadpool(desktop.lock_workstation)
                        lockdown_result['windows'] = 'requested'
                    except ActionError:
                        lockdown_result['windows'] = 'failed'
                return lockdown_result
            finally:
                admin_protocol.lockdown_pending = False

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

    app.include_router(companion.router(), dependencies=[Depends(authorized)])
    app.include_router(google_router(google, authorized, records))
    app.include_router(research_router(generate_document_answer), dependencies=[Depends(authorized)])
    app.include_router(atlas, dependencies=[Depends(authorized)])
    if records is not None:
        app.include_router(records_router(records), dependencies=[Depends(authorized)])
        app.include_router(memory_router(ImageMemories(records), recognizer), dependencies=[Depends(authorized)])
    if reader is not None:
        app.include_router(reading_router(reader), dependencies=[Depends(authorized)])
    if detector is not None or ollama is not None:
        det = detector or ObjectDetector()
        app.include_router(vision_router(det, ollama), dependencies=[Depends(authorized)])
    knowledge = ProductKnowledgeService(records.engine if records is not None else None)
    knowledge.ensure_schema()
    app.include_router(product_router(detector, ollama, knowledge), dependencies=[Depends(authorized)])
    app.include_router(admin_protocol.router(), dependencies=[Depends(authorized)])
    if recognizer is not None:
        app.include_router(people_router(recognizer, voice, protect_identity), dependencies=[Depends(authorized)])
    if voice is not None:
        app.include_router(voice_router(voice), dependencies=[Depends(authorized)])

    frontend_dist = Path(__file__).resolve().parents[2] / 'frontend/dist'
    if frontend_dist.is_dir() and (frontend_dist / 'index.html').is_file():
        if (frontend_dist / 'assets').is_dir():
            app.mount('/assets', StaticFiles(directory=str(frontend_dist / 'assets')), name='assets')
        if (frontend_dist / 'vad').is_dir():
            app.mount('/vad', StaticFiles(directory=str(frontend_dist / 'vad')), name='vad')

        if (frontend_dist / 'atlas').is_dir():
            app.mount('/atlas', StaticFiles(directory=str(frontend_dist / 'atlas')), name='atlas')

        @app.get('/', include_in_schema=False)
        def serve_root():
            return FileResponse(str((frontend_dist / 'index.html').resolve()))

    return app


try:
    records_instance = Records.from_env()
    print('Records successfully initialized with dialect:', records_instance.engine.dialect.name)
except Exception as e:
    import traceback
    traceback.print_exc()
    print('Records failed to initialize:', e)
    records_instance = None
recognizer_instance = PersonRecognizer(records_instance.engine) if records_instance else None

app = create_app(gemini=Gemini.from_env(), desktop=DesktopActions.from_env(),
                 records=records_instance, reader=ImageReader(), voice=LocalVoice(),
                 ollama=Ollama.from_env(), detector=ObjectDetector(),
                 recognizer=recognizer_instance)
