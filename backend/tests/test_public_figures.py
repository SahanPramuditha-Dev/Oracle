import json
from pathlib import Path

from app import people
from app.records import Records


def test_public_reference_is_display_only_and_enrollment_takes_priority(tmp_path, monkeypatch):
    portrait = (Path(__file__).resolve().parents[2] / 'data/readiness/vision-fixtures/portrait.jpg').read_bytes()
    (tmp_path / 'fixture-person.jpg').write_bytes(portrait)
    (tmp_path / 'catalog.json').write_text(json.dumps([
        {'id': 'fixture-person', 'name': 'Fixture Person', 'source': 'https://example.org/portrait'},
    ]), encoding='utf-8')
    monkeypatch.setattr(people, 'PUBLIC_FIGURE_DIR', tmp_path)
    recognizer = people.PersonRecognizer(Records(tmp_path / 'people.sqlite3').engine)

    assert recognizer.identify(portrait)['identified'][0]['public_figure'] is None
    result = recognizer.identify(portrait, public_figures=True)['identified'][0]
    assert result['public_figure']['id'] == 'fixture-person'
    assert result['id'] is None
    assert not result['matched'] and not result['is_admin'] and not result['access_allowed']

    recognizer.enroll('Local profile', '', portrait, consent=True)
    result = recognizer.identify(portrait, public_figures=True)['identified'][0]
    assert result['name'] == 'Local profile'
    assert result['public_figure'] is None
