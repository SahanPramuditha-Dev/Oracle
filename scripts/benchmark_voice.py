"""Score local transcription against a labeled set of WAV recordings."""

import argparse
import json
from dataclasses import replace
from math import ceil
from pathlib import Path
from statistics import median
import sys
from time import perf_counter
from unicodedata import category, normalize

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from app.voice import LocalVoice, VoiceConfig


def words(text):
    normalized = normalize('NFC', text.casefold()).replace('’', "'")
    cleaned = ''.join(
        char if category(char)[0] in 'LMN' or char == "'" else ' '
        for char in normalized
    )
    return [word.strip("'") for word in cleaned.split() if word.strip("'")]


def word_errors(expected, actual):
    previous = list(range(len(actual) + 1))
    for index, expected_word in enumerate(expected, 1):
        current = [index]
        for column, actual_word in enumerate(actual, 1):
            current.append(min(
                previous[column] + 1,
                current[-1] + 1,
                previous[column - 1] + (expected_word != actual_word),
            ))
        previous = current
    return previous[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--model', type=Path)
    parser.add_argument('--language', choices=['en', 'si', 'auto'])
    parser.add_argument('--preprocess', action=argparse.BooleanOptionalAction, default=None)
    args = parser.parse_args()

    entries = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    if not isinstance(entries, list) or not entries:
        parser.error('The manifest must contain a nonempty JSON array of recordings.')
    config = VoiceConfig.from_env()
    config = replace(config, model_path=args.model or config.model_path, language=args.language or config.language)
    voice = LocalVoice(config)
    rows = []
    for entry in entries:
        audio = (args.manifest.parent / entry['file']).read_bytes()
        start = perf_counter()
        result = voice.transcribe(
            audio, wake_mode=entry.get('wake', False), preprocess=args.preprocess, include_profile=False,
        )
        elapsed_ms = round((perf_counter() - start) * 1000)
        expected, actual = words(entry['text']), words(result['text'])
        rows.append({
            'file': entry['file'], 'kind': entry.get('kind', 'speech'),
            'expected': entry['text'], 'recognized': result['text'],
            'exact': expected == actual, 'reference_words': len(expected),
            'word_errors': word_errors(expected, actual), 'elapsed_ms': elapsed_ms,
        })

    speech = [row for row in rows if row['reference_words']]
    noise = [row for row in rows if not row['reference_words']]
    commands = [row for row in speech if row['kind'] == 'command']
    timings = sorted(row['elapsed_ms'] for row in rows)
    print(json.dumps({
        'model': str(config.model_path), 'language': config.language,
        'preprocess': config.preprocess if args.preprocess is None else args.preprocess,
        'speech_word_error_rate': (
            sum(row['word_errors'] for row in speech) / sum(row['reference_words'] for row in speech)
            if speech else None
        ),
        'exact_commands': sum(row['exact'] for row in commands),
        'command_count': len(commands),
        'noise_clips_with_transcript': sum(not row['exact'] for row in noise),
        'noise_clip_count': len(noise),
        'median_ms': median(timings),
        'p95_ms': timings[ceil(len(timings) * 0.95) - 1],
        'first_request_ms': rows[0]['elapsed_ms'],
        'recordings': rows,
    }, indent=2, ensure_ascii=True))


if __name__ == '__main__':
    main()
