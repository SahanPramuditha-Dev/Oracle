import pytest

from app.companion_gateway import Gateway, Problem


def test_pairing_survives_listener_restart_and_transport_change_until_revoked(tmp_path):
    state = tmp_path / 'companion'
    gateway = Gateway(state, tmp_path)
    code = gateway.issue()
    credential = gateway.pair(code, 'Test phone')['token']
    device_id = gateway.device(credential, 'lan')

    with pytest.raises(Problem, match='already used'):
        gateway.pair(code, 'Second phone')

    restarted_gateway = Gateway(state, tmp_path)
    assert restarted_gateway.device(credential, 'remote') == device_id
    assert restarted_gateway.revoke(device_id)

    with pytest.raises(Problem, match='Pair this phone again'):
        gateway.device(credential, 'lan')


def test_voice_retry_returns_its_own_reply_even_after_another_turn(tmp_path, monkeypatch):
    gateway = Gateway(tmp_path / 'companion', tmp_path)
    monkeypatch.setattr('app.companion_gateway.live_answer', lambda question: f'Answer to {question}')

    original = gateway.send('first', 'first question')
    newer = gateway.send('second', 'second question')
    retried = gateway.send('first', 'first question')

    assert retried['reply'] == original['reply']
    assert retried['reply']['text'] == 'Answer to first question'
    assert retried['messages'] == newer['messages']
    assert len(retried['messages']) == 4
    assert 'reply' not in gateway.history()
