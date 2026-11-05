"""Bounded text-only Gemini adapter. Credentials never enter response payloads."""
import os
import re
import ssl
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import dotenv_values

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'


class ProviderError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


@dataclass
class Gemini:
    key: str
    model: str = 'gemini-3.1-flash-lite-preview'

    @classmethod
    def from_env(cls):
        values = {**dotenv_values(ENV_PATH), **os.environ}
        key = values.get('GEMINI_API_KEY', '')
        if values.get('GEMINI_ENABLED', '').lower() != 'true' or not key:
            return None
        model = values.get('GEMINI_MODEL', 'gemini-3.1-flash-lite-preview')
        if not re.fullmatch(r'gemini-[a-zA-Z0-9.-]+', model):
            raise ValueError('GEMINI_MODEL must be a Gemini model identifier')
        return cls(key=key, model=model)

    async def answer(self, text, history):
        contents = [{'role': item.role, 'parts': [{'text': item.text}]} for item in history]
        while contents and contents[0]['role'] != 'user':
            contents.pop(0)
        contents.append({'role': 'user', 'parts': [{'text': text}]})
        # A tool result may follow a model reply; keep provider roles alternating.
        normalized = []
        for content in contents:
            if normalized and normalized[-1]['role'] == content['role']:
                normalized[-1]['parts'].extend(content['parts'])
            else:
                normalized.append({'role': content['role'], 'parts': list(content['parts'])})
        contents = normalized
        payload = {
            'systemInstruction': {'parts': [{'text': (
                'You are ORACLE, a concise and helpful personal assistant. '
                'This version can only converse using the supplied text. '
                'You cannot open applications, read files, browse the web, use a camera, '
                'create reminders or save memories. Never claim you performed such actions. '
                'Be clear about uncertainty and ask for clarification when needed.'
            )}]},
            'contents': contents,
            'generationConfig': {'maxOutputTokens': 512, 'temperature': 0.6},
        }
        try:
            # Use the OS trust store, including trusted Windows certificates; never disable TLS verification.
            async with httpx.AsyncClient(verify=ssl.create_default_context(), timeout=30) as client:
                response = await client.post(
                    f'https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent',
                    headers={'x-goog-api-key': self.key}, json=payload)
        except httpx.TimeoutException:
            raise ProviderError(504, 'provider_timeout', 'Gemini took too long. Please try again.') from None
        except httpx.RequestError:
            raise ProviderError(502, 'provider_connection', 'Could not connect to Gemini. Check your internet connection.') from None
        if response.status_code == 429:
            raise ProviderError(429, 'provider_quota', 'Gemini quota or rate limit reached. No automatic retry was made.')
        if response.status_code in (400, 401, 403):
            raise ProviderError(503, 'provider_access', 'Gemini rejected the request. Check the backend key and model access.')
        if response.status_code == 404:
            raise ProviderError(503, 'model_unavailable', 'The configured Gemini model is unavailable. Update GEMINI_MODEL in backend configuration.')
        if not response.is_success:
            raise ProviderError(502, 'provider_error', 'Gemini is temporarily unavailable. No fallback request was made.')
        try:
            data = response.json()
            candidates = data.get('candidates', [])
            parts = candidates[0].get('content', {}).get('parts', []) if candidates else []
            answer = ''.join(p.get('text', '') for p in parts if not p.get('thought')).strip()
        except (ValueError, TypeError, AttributeError, KeyError, IndexError):
            raise ProviderError(502, 'provider_response', 'Gemini returned an unreadable response.') from None
        if not answer:
            raise ProviderError(502, 'provider_empty', 'Gemini did not return a text answer. Try rephrasing your message.')
        return answer
