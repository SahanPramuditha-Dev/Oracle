"""Editable response preferences for Oracle's text models."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel


PROFILE_PATH = Path(__file__).with_name('behavior_profile.md')
BASE_INSTRUCTION = (
    'You are ORACLE, a concise and helpful personal desktop assistant. '
    'Be clear about uncertainty. Only report actions or access confirmed by the application.'
)


class ReplyPreferences(BaseModel):
    tone: Literal['professional', 'friendly', 'technical'] | None = None
    language: Literal['match', 'english', 'sinhala'] | None = None
    length: Literal['brief', 'balanced', 'detailed'] | None = None


def conversation_instruction(overrides: ReplyPreferences | None = None) -> str:
    try:
        preferences = PROFILE_PATH.read_text(encoding='utf-8-sig').strip()
    except (OSError, UnicodeError):
        preferences = ''
    sections = [BASE_INSTRUCTION]
    if preferences:
        sections.append(f'Response preferences:\n{preferences}')
    if overrides:
        tone = {
            'professional': 'Use a calm, professional tone.',
            'friendly': 'Use a warm, conversational tone.',
            'technical': 'Use a precise, technical tone and established terminology.',
        }.get(overrides.tone)
        language = {
            'match': "Match the language of the user's message.",
            'english': 'Reply in English.',
            'sinhala': 'Reply in Sinhala.',
        }.get(overrides.language)
        length = {
            'brief': 'Keep the response brief and easy to read aloud.',
            'balanced': 'Use enough detail to explain the answer and omit repetition.',
            'detailed': 'Give a thorough explanation with useful examples when relevant.',
        }.get(overrides.length)
        selected = [item for item in (tone, language, length) if item]
        if selected:
            sections.append('Use these selected preferences over the profile defaults. Follow explicit requests in the current message.\n' + '\n'.join(selected))
    return '\n\n'.join(sections)
