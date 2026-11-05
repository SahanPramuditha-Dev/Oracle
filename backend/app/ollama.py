"""Bounded local Ollama adapter for offline text inference and visual question answering."""
import base64
import os
import re
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import dotenv_values
from .gemini import ProviderError

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'


@dataclass
class Ollama:
    base_url: str = 'http://127.0.0.1:11434'
    model: str = 'qwen2.5:1.5b'
    vision_model: str = 'moondream'

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
        return cls(base_url=base_url, model=model, vision_model=vision_model)

    async def grounded_answer(self, text: str) -> str:
        schema = {'type': 'object', 'required': ['claims'], 'additionalProperties': False,
                  'properties': {'claims': {'type': 'array', 'maxItems': 4, 'items': {
                      'type': 'object', 'required': ['text', 'source', 'quote'], 'additionalProperties': False,
                      'properties': {'text': {'type': 'string'}, 'source': {'type': 'integer'}, 'quote': {'type': 'string'}}}}}}
        return await self.answer(text, [], schema=schema)

    async def answer(self, text: str, history: list, schema: dict | None = None) -> str:
        messages = [
            {
                'role': 'system',
                'content': (
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
            'keep_alive': '30m',
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
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(f'{self.base_url}/api/chat', json=payload)
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

    async def analyze_image(self, image_bytes: bytes, prompt: str) -> str:
        """Visual question answering using local vision model (e.g. Moondream)."""
        b64 = base64.b64encode(image_bytes).decode('utf-8')
        payload = {
            'model': self.vision_model,
            'prompt': prompt.strip() or 'Describe what you see in this image.',
            'images': [b64],
            'stream': False,
            'keep_alive': '30m',
            'options': {
                'temperature': 0.2,
                'num_predict': 512,
                'num_ctx': 2048,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(f'{self.base_url}/api/generate', json=payload)
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
