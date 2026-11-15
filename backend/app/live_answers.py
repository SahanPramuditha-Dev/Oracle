"""Answer clock and current-weather questions from their data sources."""

import ctypes
import json
import math
import re
import shutil
import sys
from datetime import datetime, timedelta
from decimal import Decimal, DecimalException
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import urlencode
from urllib.request import urlopen

from .tls import verified_tls


def _get_json(url, **params):
    if params:
        url += '?' + urlencode(params)
    with urlopen(url, timeout=4, context=verified_tls()) as response:
        return json.load(response)


def _conditions(code):
    if not isinstance(code, int) or isinstance(code, bool):
        return None
    if code in (0, 1, 2, 3):
        return ('clear skies', 'mostly clear skies', 'partly cloudy skies', 'overcast skies')[code]
    if code in (45, 48):
        return 'fog'
    if code in (51, 53, 55, 56, 57):
        return 'drizzle'
    if code in (61, 63, 65, 66, 67, 80, 81, 82):
        return 'rain'
    if code in (71, 73, 75, 77, 85, 86):
        return 'snow'
    if code in (95, 96, 99):
        return 'thunderstorms'
    return None


def lookup_city(city):
    matches = _get_json(
        'https://geocoding-api.open-meteo.com/v1/search', name=city, count=1, language='en'
    ).get('results', [])
    return matches[0] if matches else None


def _weather(city, daily=None):
    try:
        if city:
            location = lookup_city(city)
            if not location:
                return f'I couldn’t find {city}. Try a nearby city.'
            label = ', '.join(part for part in (location['name'], location.get('country')) if part)
        else:
            location = _get_json('https://ipwho.is/')
            if location.get('success') is not True or not location.get('city'):
                return 'I couldn’t determine your location. Ask for the weather in a specific city.'
            label = f"{location['city']} (estimated from Oracle Central’s connection)"

        if daily:
            field, day = daily
            index = int(day == 'tomorrow')
            data = _get_json(
                'https://api.open-meteo.com/v1/forecast',
                latitude=location['latitude'], longitude=location['longitude'],
                daily=field, timezone='auto', forecast_days=2,
            )['daily']
            value = data[field][index]
            if field in ('sunrise', 'sunset'):
                local_time = datetime.fromisoformat(value)
                return f'{field.title()} in {label} is at {local_time:%I:%M %p} local time {day}.'
            if not math.isfinite(value):
                raise ValueError('Missing forecast value')
            if field == 'precipitation_probability_max':
                return f'The maximum hourly chance of precipitation in {label} {day} is {value:g}%.'
            return f'The forecast for {label} {day} is a high of {value:g} °C.'

        data = _get_json(
            'https://api.open-meteo.com/v1/forecast',
            latitude=location['latitude'], longitude=location['longitude'],
            current='temperature_2m,weather_code', temperature_unit='celsius',
        )['current']
        temperature = data['temperature_2m']
        if not math.isfinite(temperature):
            raise ValueError('Missing current temperature')
        condition = _conditions(data.get('weather_code'))
        details = f' with {condition}' if condition else ''
        return f'It’s {temperature:g} °C{details} in {label}.'
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        return 'I couldn’t retrieve live weather right now. Try again or ask for the weather in a specific city.'


def _world_time(city):
    try:
        try:
            zone = ZoneInfo(city)
            label = zone.key
        except (ValueError, ZoneInfoNotFoundError):
            location = lookup_city(city)
            if not location:
                return f'I couldn’t find {city}. Try a nearby city or an IANA time zone like Asia/Tokyo.'
            zone = ZoneInfo(location['timezone'])
            label = ', '.join(part for part in (location['name'], location.get('country')) if part)
        now = datetime.now(zone)
        return f'It’s {now:%I:%M %p} in {label} on {now:%A, %B} {now.day} (UTC{now:%z}).'.replace('It’s 0', 'It’s ')
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return f'I couldn’t resolve the time zone for {city}.'


def _convert_time(clock, city, day):
    try:
        try:
            zone = ZoneInfo(city)
            label = zone.key
        except (ValueError, ZoneInfoNotFoundError):
            location = lookup_city(city)
            if not location:
                return f'I couldn’t find {city}.'
            zone = ZoneInfo(location['timezone'])
            label = location['name']
        date = datetime.now(zone).date() + timedelta(days=int(day.lower() == 'tomorrow'))
        time = datetime.strptime(clock.replace(' ', '').upper(), '%I:%M%p' if ':' in clock else '%I%p').time()
        wall = datetime.combine(date, time)
        source = wall.replace(tzinfo=zone)
        alternate = source.replace(fold=1)
        if source.utcoffset() != alternate.utcoffset():
            return 'That local time falls in a daylight-saving transition. Choose another time.'
        local = source.astimezone()
        return f'{source:%I:%M %p on %A, %B %d} in {label} is {local:%I:%M %p on %A, %B %d} in Oracle Central’s local time (UTC{local:%z}).'
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return 'I couldn’t convert that time. Check the city and use a time like 9 AM.'


def _disk_space(drive):
    if sys.platform != 'win32':
        return 'Drive-letter storage reporting is available on Windows.'
    try:
        usage = shutil.disk_usage(drive.upper() + ':\\')
    except OSError:
        return f'I couldn’t read drive {drive.upper()}: on Oracle Central.'
    return f'Drive {drive.upper()}: on Oracle Central has {usage.free / 2**30:.1f} GiB free out of {usage.total / 2**30:.1f} GiB.'


NUMBER = r'[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?'
UNITS = {
    'b': (1000, 0), 'kb': (1000, 1), 'mb': (1000, 2), 'gb': (1000, 3), 'tb': (1000, 4),
    'kib': (1024, 1), 'mib': (1024, 2), 'gib': (1024, 3), 'tib': (1024, 4),
}
UNIT_LABELS = {unit: unit[0].upper() + 'iB' if 'i' in unit else unit.upper() for unit in UNITS}
MEASURES = {
    'length': {'mm': '0.001', 'cm': '0.01', 'm': '1', 'km': '1000', 'inch': '0.0254',
               'foot': '0.3048', 'yard': '0.9144', 'mile': '1609.344'},
    'mass': {'mg': '0.001', 'g': '1', 'kg': '1000', 'pound': '453.59237', 'ounce': '28.349523125'},
    'volume': {'ml': '0.001', 'liter': '1', 'us gallon': '3.785411784'},
    'duration': {'second': '1', 'minute': '60', 'hour': '3600', 'day': '86400', 'week': '604800'},
}
UNIT_ALIASES = {
    'millimeter': 'mm', 'centimeter': 'cm', 'meter': 'm', 'kilometer': 'km', 'inches': 'inch',
    'feet': 'foot', 'ft': 'foot', 'in': 'inch', 'mi': 'mile', 'gram': 'g', 'kilogram': 'kg',
    'lb': 'pound', 'oz': 'ounce', 'litre': 'liter', 'milliliter': 'ml', 'millilitre': 'ml',
    '°c': 'celsius', '°f': 'fahrenheit',
}


def _measure_unit(value):
    value = value.lower()
    return UNIT_ALIASES.get(value, value if value == 'celsius' else
                            UNIT_ALIASES.get(value.removesuffix('s'), value.removesuffix('s')))


def _measurement(query):
    if match := re.fullmatch(rf'convert ({NUMBER}) (.+?) to (.+)', query, re.I):
        amount, source, target = match.groups()
    elif match := re.fullmatch(rf'how many (.+?) (?:are )?in (?:({NUMBER}) |(?:an?|one) )?(.+)', query, re.I):
        target, amount, source = match.groups()
        amount = amount or '1'
    else:
        return None
    source, target = _measure_unit(source), _measure_unit(target)
    value = _decimal(amount)
    for units in MEASURES.values():
        if source in units and target in units:
            result = value * Decimal(units[source]) / Decimal(units[target])
            return f'{amount} {source} = {result:.12g} {target}.'
    if {source, target} <= {'celsius', 'fahrenheit', 'kelvin'}:
        celsius = {'celsius': lambda: value, 'fahrenheit': lambda: (value - 32) * 5 / 9,
                   'kelvin': lambda: value - Decimal('273.15')}[source]()
        result = {'celsius': lambda: celsius, 'fahrenheit': lambda: celsius * 9 / 5 + 32,
                  'kelvin': lambda: celsius + Decimal('273.15')}[target]()
        return f'{amount} {source} = {result:.12g} {target}.'
    return None


def _decimal(value):
    return Decimal(value.replace(',', ''))


def _currency(amount, source, target):
    source = 'LKR' if len(source) != 3 else source.upper()
    target = 'LKR' if len(target) != 3 else target.upper()
    if source == target:
        return f'{amount} {source} equals the same amount in {target}.'
    try:
        data = _get_json('https://api.frankfurter.dev/v2/rates', base=source, quotes=target)[0]
        date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        rate = Decimal(str(data['rate']))
        if data['base'] != source or data['quote'] != target or not rate.is_finite() or rate <= 0:
            raise ValueError('Invalid reference rate')
        converted = _decimal(amount) * rate
        return f'{amount} {source} is approximately {converted:,.2f} {target} at the Frankfurter reference rate of {rate} on {date:%Y-%m-%d}.'
    except (OSError, ValueError, KeyError, TypeError, IndexError, DecimalException):
        return f'I couldn’t retrieve a reference exchange rate for {source} to {target}.'


def _format_number(value):
    return f'{value.normalize():f}'


def _calculation(query):
    if len(query) > 120:
        return None
    expression = re.sub(r"^(?:what is |what's |calculate )", '', query, flags=re.I)
    match = re.fullmatch(rf'({NUMBER})\s*(?:%|percent) of ({NUMBER})( rupees| lkr)?', expression, re.I)
    if match:
        return f'{_format_number(_decimal(match[1]) * _decimal(match[2]) / 100)}{match[3] or ""}.'
    match = re.fullmatch(rf'({NUMBER})\s*(\+|[-−]|[×*]|[÷/]|plus|minus|times|divided by)\s*({NUMBER})', expression, re.I)
    if match:
        left, right = _decimal(match[1]), _decimal(match[3])
        operator = match[2].lower()
        try:
            if operator in ('+', 'plus'):
                result = left + right
            elif operator in ('-', '−', 'minus'):
                result = left - right
            elif operator in ('×', '*', 'times'):
                result = left * right
            else:
                result = left / right
            return f'{_format_number(result)}.'
        except DecimalException:
            return 'Division by zero is undefined.' if not right else 'I couldn’t calculate that result.'

    units = '|'.join(UNITS)
    match = re.fullmatch(rf'how many ({units}) (?:are )?in ({NUMBER})\s*({units})', query, re.I)
    if match:
        target, amount, source = match.groups()
        source_base, source_power = UNITS[source.lower()]
        target_base, target_power = UNITS[target.lower()]
        result = _decimal(amount) * source_base ** source_power / target_base ** target_power
        convention = 'decimal units' if source_base == target_base == 1000 else 'IEC binary units where marked with i'
        return f'{amount} {UNIT_LABELS[source.lower()]} is {_format_number(result)} {UNIT_LABELS[target.lower()]} ({convention}).'
    return None


def _countdown(value):
    today = datetime.now().date()
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            target = datetime.fromisoformat(value).date()
        else:
            parsed = datetime.strptime(f'{value} 2000', '%B %d %Y')
            for year in range(today.year, today.year + 9):
                try:
                    target = parsed.replace(year=year).date()
                except ValueError:
                    continue
                if target >= today:
                    break
    except ValueError:
        return 'Use a date like December 25 or 2027-12-25.'
    days = (target - today).days
    if days < 0:
        return f'{target:%B} {target.day}, {target.year} was {-days} days ago.'
    return f'{days} {"day" if days == 1 else "days"} until {target:%B} {target.day}, {target.year}.'


def _memory_usage():
    if sys.platform != 'win32':
        return 'PC memory reporting is available on Windows.'
    from ctypes import wintypes

    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD)] + [
            (name, ctypes.c_ulonglong) for name in (
                'total_physical', 'available_physical', 'total_page', 'available_page',
                'total_virtual', 'available_virtual', 'available_extended_virtual',
            )
        ]

    status = MemoryStatus(length=ctypes.sizeof(MemoryStatus))
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return 'I couldn’t read Windows memory usage.'
    used = (status.total_physical - status.available_physical) / 2**30
    return f'The PC running Oracle Central is using {used:.1f} of {status.total_physical / 2**30:.1f} GiB of RAM ({status.load}%).'


CALENDAR_QUESTION = re.compile(r"(?:what(?:'s| is) my next (?:meeting|calendar event)|when is my next meeting)", re.I)
CALENDAR_TOMORROW = re.compile(r"(?:what(?:'s| is) on my calendar tomorrow|show (?:me )?my calendar (?:for )?tomorrow)", re.I)
NEXT_REMINDER = re.compile(r"(?:when(?:'s| is)|what(?:'s| is)) my next reminder", re.I)
TIMER_QUESTION = re.compile(r"(?:how much time is left on my timer|(?:what are|show|list) (?:my )?(?:active )?timers)", re.I)
DEPARTURE_QUESTION = re.compile(r"when should i leave for my next meeting", re.I)
REMINDER_QUESTION = re.compile(
    r"(?:what reminders do i have today|(?:show|list) (?:my )?reminders (?:for )?today|what are my reminders (?:for )?today)", re.I
)
ROUTE_QUESTION = re.compile(r'how far am i from (.{1,100}?)(?:,? and how long will it take)?', re.I)


def normalize_question(text):
    query = ' '.join(text.replace('’', "'").split()).rstrip(' ?.!')
    query = re.sub(r'^(?:(?:hello|hi|hey|okay|ok|oracle)[, !.]+)+', '', query, flags=re.I)
    return re.sub(r'^(?:please |(?:can|could|would) you (?:please )?tell (?:me|e) |tell me )+', '', query, flags=re.I)


# Match the question wording and leave city names, values and units untouched.
QUESTION_PREFIXES = (
    'the time', 'the current time', 'the date', "whats todays date",
    'what time is it', 'what is the current time', 'what is the time', "what's the time",
    'what is the date', "what's the date", 'what day is it', "what is today's date",
    "what's the weather", 'what is the weather', 'how is the weather',
    'will it rain', 'what time is sunrise', 'what time is sunset',
    'how many days until', 'how many', 'how much is',
    'how much storage is left', 'how much disk space is left',
    'how much ram is my pc using', 'how much time is left on my timer',
    "what's my next meeting", 'when is my next meeting', "what's on my calendar",
    "when's my next reminder", 'when is my next reminder', 'what reminders do i have',
    'when should i leave for my next meeting', 'when should i leave', 'how far am i from', 'what can i ask',
    'and tomorrow', 'what about tomorrow', 'where is it', 'where is my next meeting',
)
QUESTION_WORDS = frozenset(
    'current time date weather today tomorrow sunrise sunset here now meeting calendar '
    'reminder reminders timer timers storage calculator'.split()
)


def _one_edit(value, expected):
    if abs(len(value) - len(expected)) > 1:
        return False
    if len(value) == len(expected):
        differences = [i for i, (a, b) in enumerate(zip(value, expected)) if a != b]
        return len(differences) == 1 or (
            len(differences) == 2 and (i := differences[0]) + 1 == differences[1]
            and value[i:i + 2] == expected[i:i + 2][::-1]
        )
    shorter, longer = sorted((value, expected), key=len)
    i = next((i for i, (a, b) in enumerate(zip(shorter, longer)) if a != b), len(shorter))
    return shorter[i:] == longer[i + 1:]


def correct_question(text):
    query = normalize_question(text)
    # Action commands must retain their wording, even when they resemble a question typo.
    action_query = re.sub(r'^(?:(?:can|could|would) you |please )+', '', query, flags=re.I)
    if re.match(r'^(?:open|close|launch|start|stop|activate|deactivate|enable|disable|hide|exit|minimize|run|show|display|view|enter|bring up|turn on|turn off)\b', action_query, re.I):
        return text
    if len(query) > 160:
        return text
    tokens = query.split()
    lower = [token.lower() for token in tokens]
    matches = []
    for prefix in QUESTION_PREFIXES:
        words = prefix.split()
        if len(words) > len(tokens):
            continue
        edits = 0
        for actual, expected in zip(lower, words):
            if actual == expected or actual == expected.replace("'", ''):
                continue
            if (len(expected) < 3 or actual in QUESTION_WORDS or not _one_edit(actual, expected.replace("'", ""))):
                break
            edits += 1
        else:
            if edits <= 2 and edits < len(words):
                matches.append((len(words), -edits, prefix))
    if not matches:
        return text
    size, score, prefix = max(matches)
    if sum((length, edits) == (size, score) for length, edits, _ in matches) > 1:
        return text
    suffix = tokens[size:]
    if prefix in ('the time', 'the current time', 'what time is it', 'what is the current time',
                  'what is the time', "what's the time") and [word.lower() for word in suffix] == ['rn']:
        suffix = ['right now']
    # A final day qualifier can be corrected when it cannot be part of a place.
    if len(suffix) == 1 and prefix in ("what's the weather", 'what is the weather',
                                      'will it rain', "what's on my calendar",
                                      'what reminders do i have'):
        day = suffix[0].lower()
        if day not in ('today', 'tomorrow'):
            days = [word for word in ('today', 'tomorrow') if _one_edit(day, word)]
            if len(days) == 1:
                suffix[0] = days[0]
    return ' '.join((prefix, *suffix))


CURRENT_WEATHER = re.compile(
    r"(?:(?:what is|what's|whats|how is|how's) )?(?:the )?(?:current )?weather"
    r"(?: (?:in|at|for) ([^?]{1,100}?))?(?: like)?(?: right now| now| today| here)?",
    re.I,
)


def resolve_follow_up(text, previous_question):
    if not previous_question:
        return text
    query, previous = normalize_question(correct_question(text)), normalize_question(correct_question(previous_question))
    if re.fullmatch(r'(?:and |what about )?tomorrow', query, re.I):
        if match := CURRENT_WEATHER.fullmatch(previous):
            return f'What is the weather tomorrow in {match[1]}' if match[1] else 'What is the weather tomorrow'
    if CALENDAR_QUESTION.fullmatch(previous):
        if re.fullmatch(r'where is (?:it|that|the meeting)', query, re.I):
            return 'Where is my next meeting'
    if re.fullmatch(r'when should i leave', query, re.I) and (
        CALENDAR_QUESTION.fullmatch(previous) or MEETING_LOCATION.fullmatch(previous)
    ):
        return 'When should I leave for my next meeting'
    return text


MEETING_LOCATION = re.compile(r'where is my next meeting', re.I)


def live_answer(text, weather_city=None):
    query = normalize_question(correct_question(text))
    if re.fullmatch(r'(?:what can i ask(?: you| oracle)?|show (?:me )?example questions)', query, re.I):
        return (
            'Try “What time is it in Tokyo?”, “What’s the weather in Colombo?”, '
            '“How many centimeters are in an inch?”, “What’s on my calendar tomorrow?”, '
            '“How much time is left on my timer?”, or “How much storage is left?”.'
        )
    if re.fullmatch(r"(?:how much (?:free )?(?:storage|disk space|space) is left|how much free (?:storage|disk space) do i have)(?: on my (?:pc|computer))?", query, re.I):
        if sys.platform != 'win32':
            return 'Drive-letter storage reporting is available on Windows.'
        import os
        drives = ctypes.windll.kernel32.GetLogicalDrives()
        fixed = [chr(65 + index) for index in range(26) if drives & (1 << index)
                 and ctypes.windll.kernel32.GetDriveTypeW(chr(65 + index) + ':\\') == 3]
        return '\n'.join(_disk_space(drive) for drive in fixed) or f'I couldn’t find any fixed drives on {os.environ.get("COMPUTERNAME", "Oracle Central")}.'
    if re.fullmatch(r"(?:what(?:'s| is) (?:the date )?tomorrow|what day is tomorrow|what(?:'s| is) tomorrow's date)", query, re.I):
        tomorrow = datetime.now().date() + timedelta(days=1)
        return f'Tomorrow is {tomorrow:%A, %B} {tomorrow.day}, {tomorrow.year}.'
    if match := re.fullmatch(r'(?:how do you spell|spell) ([^\W\d_]{1,40})', query, re.I):
        return ' · '.join(match[1].upper()) + '.'
    if len(query) <= 120 and (answer := _measurement(query)):
        return answer
    if match := re.fullmatch(r"what time (?:will it be|is it) here when it(?:'s| is) (\d{1,2}(?::\d{2})?\s*[ap]m) in (.{1,100}?) (today|tomorrow)", query, re.I):
        return _convert_time(*match.groups())
    if match := re.fullmatch(r"how much (?:free )?(?:storage|disk space|space) (?:is left|is free|do i have) on (?:my |the )?(?:drive )?([a-z]):?(?: drive)?", query, re.I):
        return _disk_space(match[1])
    if len(query) <= 120 and (match := re.fullmatch(
        rf"(?:how much is |convert )({NUMBER})\s+([a-z]{{3}}|sri lankan rupees?) (?:in|to) ([a-z]{{3}}|sri lankan rupees?)",
        query, re.I,
    )):
        return _currency(*match.groups())
    if match := re.fullmatch(r"(?:what time is it|what(?:'s| is) the (?:current )?time) in (.{1,100}?)(?: right now| now)?", query, re.I):
        return _world_time(match[1])
    if match := re.fullmatch(r'how many days until (.{1,40})', query, re.I):
        return _countdown(match[1])
    if answer := _calculation(query):
        return answer
    if re.fullmatch(r"how much (?:ram|memory) is (?:my|the) (?:pc|computer) using|(?:current )?ram usage", query, re.I):
        return _memory_usage()
    if match := re.fullmatch(r'will it rain(?: in (.{1,100}?))? (today|tomorrow)(?: in (.{1,100}))?', query, re.I):
        return _weather(match[1] or match[3] or weather_city, ('precipitation_probability_max', match[2].lower()))
    if match := re.fullmatch(r"what(?:'s| is) the weather(?: like)?(?: in (.{1,100}?))? tomorrow(?: in (.{1,100}))?", query, re.I):
        return _weather(match[1] or match[2] or weather_city, ('temperature_2m_max', 'tomorrow'))
    if match := re.fullmatch(r'what time is (sunrise|sunset)(?: in (.{1,100}?))?(?: (today|tomorrow))?', query, re.I):
        return _weather(match[2] or weather_city, (match[1].lower(), (match[3] or 'today').lower()))
    if re.fullmatch(r"(?:(?:what is|what's|whats) )?(?:the )?(?:current |local )?time(?: is it)?(?: right now| now| here)?|what time is it(?: right now| now| here)?", query, re.I):
        now = datetime.now().astimezone()
        return f'It’s {now:%I:%M %p} (Oracle Central local time, UTC{now:%z}).'.replace('It’s 0', 'It’s ')
    if re.fullmatch(r"(?:(?:what is|what's|whats) )?(?:the |today's )?(?:current )?date(?: today)?|what day is it(?: today)?|(?:what is|what's|whats) today'?s date", query, re.I):
        now = datetime.now().astimezone()
        return f'Today is {now:%A, %B} {now.day}, {now.year} (Oracle Central local date).'
    match = CURRENT_WEATHER.fullmatch(query)
    if not match:
        shorthand = re.fullmatch(r'([a-z]{5,8}) in (.{1,100})', query, re.I)
        if shorthand and (shorthand[1].lower() == 'weather' or _one_edit(shorthand[1].lower(), 'weather')):
            return _weather(shorthand[2])
    if match:
        return _weather(match[1] or weather_city)
    return None
