"""Bounded local Ollama adapter for offline text inference and visual question answering."""
import json
import base64
import os
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from dotenv import dotenv_values
from .behavior import ReplyPreferences, conversation_instruction
from .tls import verified_tls
from .gemini import ProviderError

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'


@dataclass
class Ollama:
    base_url: str = 'http://127.0.0.1:11434'
    model: str = 'qwen2.5:1.5b'
    vision_model: str = 'moondream'
    keep_alive: str = '5m'
    _client: httpx.AsyncClient | None = field(default=None, init=False, repr=False, compare=False)

    @asynccontextmanager
    async def lifespan(self):
        async with httpx.AsyncClient(verify=verified_tls()) as client:
            self._client = client
            try:
                yield
            finally:
                self._client = None

    @asynccontextmanager
    async def _http(self):
        if self._client is not None:
            yield self._client
        else:
            async with httpx.AsyncClient(verify=verified_tls()) as client:
                yield client


    def update_model(self, new_model: str) -> None:
        if not re.fullmatch(r'[a-zA-Z0-9_.:-]+', new_model):
            raise ValueError('Invalid Ollama model identifier')
        if ENV_PATH.exists():
            content = ENV_PATH.read_text(encoding='utf-8')
            pattern = r'^OLLAMA_MODEL=.*$'
            if re.search(pattern, content, flags=re.MULTILINE):
                new_content = re.sub(pattern, f'OLLAMA_MODEL={new_model}', content, flags=re.MULTILINE)
            else:
                new_content = content.rstrip() + f'\nOLLAMA_MODEL={new_model}\n'
            ENV_PATH.write_text(new_content, encoding='utf-8')

    async def list_models(self) -> list[dict]:
        try:
            async with self._http() as client:
                resp = await client.get(f'{self.base_url}/api/tags', timeout=5.0)
                if resp.status_code == 200:
                    return resp.json().get('models', [])
        except Exception:
            pass
        return []

    @classmethod
    def from_env(cls):
        values = {**dotenv_values(ENV_PATH), **os.environ}
        enabled = values.get('OLLAMA_ENABLED', '').lower() in ('true', '1', 'yes')
        if not enabled:
            return None
        base_url = values.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
        model = values.get('OLLAMA_MODEL', 'qwen2.5:1.5b').strip()
        vision_model = values.get('OLLAMA_VISION_MODEL', 'moondream').strip()
        if not re.fullmatch(r'[a-zA-Z0-9_.:-]+', model):
            raise ValueError('OLLAMA_MODEL must be a valid Ollama model identifier')
        if not re.fullmatch(r'[a-zA-Z0-9_.:-]+', vision_model):
            raise ValueError('OLLAMA_VISION_MODEL must be a valid Ollama model identifier')
        keep_alive = values.get('OLLAMA_KEEP_ALIVE', '5m').strip() or '5m'
        return cls(base_url=base_url, model=model, vision_model=vision_model, keep_alive=keep_alive)

    async def grounded_answer(self, text: str) -> str:
        schema = {'type': 'object', 'required': ['claims'], 'additionalProperties': False,
                  'properties': {'claims': {'type': 'array', 'maxItems': 4, 'items': {
                      'type': 'object', 'required': ['text', 'source', 'quote'], 'additionalProperties': False,
                      'properties': {'text': {'type': 'string'}, 'source': {'type': 'integer'}, 'quote': {'type': 'string'}}}}}}
        return await self.answer(text, [], schema=schema)

    async def answer(self, text: str, history: list, schema: dict | None = None, *, reply_preferences: ReplyPreferences | None = None) -> str:
        messages = [
            {
                'role': 'system',
                'content': conversation_instruction(reply_preferences) if schema is None else (
                    'You are ORACLE, a concise and helpful personal assistant. '
                    'This version can only converse using the supplied text. '
                    'You cannot open applications, read files, browse the web, use a camera, '
                    'create reminders or save memories unless explicitly executed through tools. '
                    'Be clear about uncertainty and ask for clarification when needed.'
                ),
            }
        ]
        for item in history:
            role = 'assistant' if item.role == 'model' else item.role
            messages.append({'role': role, 'content': item.text})
        messages.append({'role': 'user', 'content': text})

        payload = {
            'model': self.model,
            'messages': messages,
            'stream': False,
            'keep_alive': self.keep_alive,
            'options': {
                'temperature': 0.6,
                'num_predict': 512,
                'num_ctx': 2048,
            },
        }
        if schema is not None:
            payload['format'] = schema
            payload['options']['temperature'] = 0

        try:
            async with self._http() as client:
                response = await client.post(f'{self.base_url}/api/chat', json=payload, timeout=60.0)
        except httpx.TimeoutException:
            raise ProviderError(504, 'provider_timeout', 'Ollama took too long to respond. Please try again.') from None
        except httpx.RequestError:
            raise ProviderError(502, 'provider_connection', 'Could not connect to Ollama. Ensure Ollama is running on 127.0.0.1:11434.') from None

        if response.status_code == 404:
            raise ProviderError(503, 'model_unavailable', f'Model {self.model} not found in Ollama. Pull it with: ollama pull {self.model}')
        if not response.is_success:
            raise ProviderError(502, 'provider_error', f'Ollama error (HTTP {response.status_code}). No fallback request was made.')

        try:
            data = response.json()
            message_obj = data.get('message', {})
            answer = message_obj.get('content', '').strip()
        except (ValueError, TypeError, AttributeError, KeyError):
            raise ProviderError(502, 'provider_response', 'Ollama returned an unreadable response.') from None

        if not answer:
            raise ProviderError(502, 'provider_empty', 'Ollama returned an empty response. Try rephrasing your message.')

        return answer

    async def answer_stream(self, text: str, history: list, *, reply_preferences: ReplyPreferences | None = None):
        """Yield actual model tokens; callers retain cancellation and quota control."""
        messages = [{'role': 'system', 'content': conversation_instruction(reply_preferences)}]
        messages.extend({'role': 'assistant' if item.role == 'model' else item.role,
                         'content': item.text} for item in history)
        messages.append({'role': 'user', 'content': text})
        payload = {'model': self.model, 'messages': messages, 'stream': True,
                   'keep_alive': self.keep_alive, 'options': {'temperature': .6, 'num_predict': 512, 'num_ctx': 2048}}
        received = False
        try:
            async with self._http() as client:
                async with client.stream('POST', f'{self.base_url}/api/chat', json=payload, timeout=60.0) as response:
                    if response.status_code == 404:
                        raise ProviderError(503, 'model_unavailable', f'Model {self.model} is not available in Ollama.')
                    if not response.is_success:
                        raise ProviderError(502, 'provider_error', f'Ollama error (HTTP {response.status_code}).')
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        data = json.loads(line)
                        if data.get('error'):
                            raise ProviderError(502, 'provider_error', str(data['error']))
                        token = data.get('message', {}).get('content', '')
                        if token:
                            received = True
                            yield token
            if not received:
                raise ProviderError(502, 'provider_empty', 'Ollama returned an empty response.')
        except httpx.TimeoutException:
            raise ProviderError(504, 'provider_timeout', 'Ollama took too long to respond.') from None
        except httpx.RequestError:
            raise ProviderError(502, 'provider_connection', 'Could not connect to Ollama.') from None
        except (ValueError, TypeError, AttributeError):
            raise ProviderError(502, 'provider_response', 'Ollama returned an unreadable response.') from None

    async def analyze_image(self, image_bytes: bytes, prompt: str) -> str:
        """Visual question answering using local vision model (e.g. Moondream)."""
        b64 = base64.b64encode(image_bytes).decode('utf-8')
        payload = {
            'model': self.vision_model,
            'prompt': prompt.strip() or 'Describe what you see in this image.',
            'images': [b64],
            'stream': False,
            'keep_alive': self.keep_alive,
            'options': {
                'temperature': 0.2,
                'num_predict': 512,
                'num_ctx': 2048,
            },
        }
        try:
            async with self._http() as client:
                response = await client.post(f'{self.base_url}/api/generate', json=payload, timeout=90.0)
        except httpx.TimeoutException:
            raise ProviderError(504, 'provider_timeout', 'Vision model took too long to analyze the image.') from None
        except httpx.RequestError:
            raise ProviderError(502, 'provider_connection', 'Could not connect to local Ollama vision service.') from None

        if response.status_code == 404:
            raise ProviderError(503, 'model_unavailable', f'Vision model {self.vision_model} not found in Ollama. Pull it with: ollama pull {self.vision_model}')
        if not response.is_success:
            raise ProviderError(502, 'provider_error', f'Vision inference error (HTTP {response.status_code}).')

        try:
            data = response.json()
            answer = data.get('response', '').strip()
        except Exception:
            raise ProviderError(502, 'provider_response', 'Vision model returned an unreadable response.') from None

        if not answer:
            raise ProviderError(502, 'provider_empty', 'Vision model did not produce an answer.')

        return answer
