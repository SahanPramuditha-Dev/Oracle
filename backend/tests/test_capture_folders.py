from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import insert

from app.database import people
from app.memory import CaptureLink, ImageMemories
from app.people import PersonRecognizer
from app.records import NoteInput, Records


def test_reviewed_captures_link_atomically_and_can_return_to_review(tmp_path):
    records = Records(tmp_path / 'captures.sqlite3')
    store = ImageMemories(records)
    with records.connect(write=True) as db:
        db.execute(insert(people).values(id='person', name='Person', notes='', created=1, updated=1,
                                        consent_status='granted'))
    image = BytesIO()
    Image.new('RGB', (128, 128)).save(image, format='PNG')
    capture = store.save(image.getvalue(), NoteInput(title='Unidentified unknown-1',
                         text='Auto-saved cropped face for unknown-1.'), '', 'camera')
    ordinary = store.save(image.getvalue(), NoteInput(title='Photo', text='Ordinary memory'), '', 'camera')
    with pytest.raises(HTTPException, match='no longer available'):
        store.link_captures(CaptureLink(ids=[capture['id'], ordinary['id']], person_id='person'))
    assert all(row['capture_person_id'] is None for row in store.find(''))
    store.link_captures(CaptureLink(ids=[capture['id']], person_id='person'))
    store.expire_captures(records.now() + 1)
    assert store.find('Unidentified')[0]['capture_person_id'] == 'person'
    store.link_captures(CaptureLink(ids=[capture['id']], person_id=None))
    assert store.find('Unidentified')[0]['capture_person_id'] is None
    store.expire_captures(records.now() + 1)
    assert [row['id'] for row in store.find('')] == [ordinary['id']]


def test_matching_captures_group_before_enrollment_and_suggest_profile_after(tmp_path):
    records = Records(tmp_path / 'groups.sqlite3')
    recognizer = PersonRecognizer(records.engine)
    portrait = Path(__file__).resolve().parents[2] / 'data/readiness/vision-fixtures/portrait.jpg'
    if not portrait.is_file():
        pytest.skip('Portrait fixture unavailable')
    image = portrait.read_bytes()
    captures = [('first', image), ('second', image)]
    assert recognizer.group_captures(captures) == [
        {'ids': ['first', 'second'], 'person_id': None, 'auto_ids': [], 'reason': 'No confident profile match'}]
    profile = recognizer.enroll('Person', '', image, consent=True)
    assert recognizer.group_captures(captures) == [
        {'ids': ['first', 'second'], 'person_id': profile['id'], 'auto_ids': ['first', 'second'], 'reason': None}]
    store = ImageMemories(records)
    capture = store.save(image, NoteInput(title='Unidentified unknown-1',
                         text='Auto-saved cropped face for unknown-1.'), '', 'camera')
    assert store.group_captures(recognizer)['assigned'] == {}
    assert store.group_captures(recognizer, auto_assign=True)['assigned'] == {capture['id']: profile['id']}
    store.link_captures(CaptureLink(ids=[capture['id']], person_id=None))
    assert store.group_captures(recognizer, auto_assign=True)['assigned'] == {}
