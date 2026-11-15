import json
import sqlite3
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from app.control_adapters import (
    ApplicationControlAdapter,
    AudioControlAdapter,
    DisplayControlAdapter,
    InputControlAdapter,
    MediaControlAdapter,
    PowerControlAdapter,
    PROTECTED_PROCESSES,
)
from app.control_manager import ControlManager
from app.control_routines import RoutineEngine
from app.control_scheduler import ControlScheduler


@pytest.fixture
def temp_db():
    tmp = tempfile.NamedTemporaryFile(delete=False)
    path = tmp.name
    tmp.close()

    def get_conn():
        return sqlite3.connect(path)

    yield get_conn
    try:
        Path(path).unlink(missing_ok=True)
    except Exception:
        pass


def test_power_adapter_stay_awake():
    power = PowerControlAdapter()
    res = power.stay_awake(duration_seconds=120)
    assert res["status"] == "completed"
    assert res["remaining_seconds"] == 120

    status = power.stay_awake_status()
    assert status["active"] is True
    assert status["remaining_seconds"] > 0

    cancel_res = power.cancel_stay_awake()
    assert cancel_res["status"] == "completed"
    assert power.stay_awake_status()["active"] is False


def test_audio_adapter_safeguards():
    audio = AudioControlAdapter()
    # Test setting volume within bounds
    res = audio.set_master_volume(45)
    assert res["percent"] == 45
    assert res["status"] == "completed"

    mute_res = audio.set_mute(True)
    assert mute_res["muted"] is True
    assert mute_res["status"] == "completed"

    unmute_res = audio.set_mute(False)
    assert unmute_res["muted"] is False


def test_app_control_safeguards():
    app = ApplicationControlAdapter()
    # Test protected process termination prevention
    with pytest.raises(RuntimeError) as exc:
        app.terminate_process(4)  # System PID
    assert "protected system process" in str(exc.value)

    # Test approved apps list
    approved = app.list_approved_apps()
    assert len(approved) >= 5
    ids = [a["id"] for a in approved]
    assert "vscode" in ids
    assert "chrome" in ids
    assert "calc" in ids


def test_scheduler_lifecycle_and_idempotency(temp_db):
    dispatched = []

    def mock_dispatch(action, params):
        dispatched.append((action, params))
        return {"status": "completed", "message": "Done"}

    sched = ControlScheduler(temp_db, mock_dispatch)
    # Create schedule in future
    created = sched.create_schedule(
        action="power.lock",
        parameters={},
        creator="device-1",
        delay_seconds=3600
    )
    assert created["id"]
    assert created["status"] == "pending"
    assert created["remaining_seconds"] > 3500

    # List schedules
    schedules = sched.list_schedules()
    assert len(schedules) == 1
    assert schedules[0]["id"] == created["id"]

    # Cancel schedule
    cancelled = sched.cancel_schedule(created["id"], "device-1")
    assert cancelled["status"] == "cancelled"

    # Cannot cancel already cancelled
    with pytest.raises(ValueError):
        sched.cancel_schedule(created["id"], "device-1")

    sched.stop()


def test_routines_execution_and_custom_creation(temp_db):
    dispatched = []

    def mock_dispatch(action, params):
        dispatched.append((action, params))
        return {"status": "completed"}

    engine = RoutineEngine(temp_db, mock_dispatch)
    routines = engine.list_routines()
    assert len(routines) >= 4  # Default presets

    # Create custom routine
    custom = engine.save_routine(
        name="Focus Session",
        description="Lowers volume and stays awake",
        steps=[
            {"action": "audio.set_volume", "parameters": {"percent": 20}},
            {"action": "power.stay_awake", "parameters": {"duration_seconds": 1800}}
        ]
    )
    assert custom["id"]
    assert custom["name"] == "Focus Session"
    assert len(custom["steps"]) == 2

    # Run routine
    run_res = engine.run_routine(custom["id"], "test-dev")
    assert run_res["status"] == "accepted"
    time.sleep(0.3)  # Allow async thread to run steps
    assert len(dispatched) >= 2
    assert dispatched[0][0] == "audio.set_volume"
    assert dispatched[1][0] == "power.stay_awake"


def test_control_manager_idempotency_and_state(temp_db):
    cm = ControlManager(temp_db)
    req_id = "unique-client-req-999"

    # First execution
    res1 = cm.handle_command("dev-1", "audio.set_volume", {"percent": 30}, request_id=req_id)
    assert res1["status"] == "completed"

    # Duplicate call with same request_id returns cached result
    res2 = cm.handle_command("dev-1", "audio.set_volume", {"percent": 30}, request_id=req_id)
    assert res2["command_id"] == res1["command_id"]
    assert res2["status"] == "completed"

    # Verify state snapshot
    state = cm.get_state()
    assert state["revision"] >= 1
    assert "power" in state
    assert "audio" in state
    assert "display" in state
    assert "media" in state
    assert "applications" in state
    assert "schedules" in state

    # Verify capabilities
    caps = cm.get_capabilities()
    assert caps["canLock"] is True
    assert caps["canShutdown"] is True
    assert "platform" in caps

    cm.scheduler.stop()


def test_voice_control_intent_matching(temp_db):
    from app.companion_gateway import resolve_control_voice_intent

    mock_gateway = MagicMock()
    mock_gateway.execute_control_command.return_value = {"status": "completed"}
    mock_gateway.scheduler.get_next_scheduled_action.return_value = None

    # Test lock intent
    reply = resolve_control_voice_intent("Oracle, lock my PC", mock_gateway, "dev-1")
    assert "locked your Windows workstation" in reply
    mock_gateway.execute_control_command.assert_called_with("dev-1", "power.lock", {})

    # Test volume intent
    reply = resolve_control_voice_intent("set PC volume to 40 percent", mock_gateway, "dev-1")
    assert "PC master volume set to 40%" in reply
    mock_gateway.execute_control_command.assert_called_with("dev-1", "audio.set_volume", {"percent": 40})

    # Test mute intent
    reply = resolve_control_voice_intent("mute the computer", mock_gateway, "dev-1")
    assert "muted" in reply

    # Test display off
    reply = resolve_control_voice_intent("turn off the screen", mock_gateway, "dev-1")
    assert "Display low-power sleep command dispatched" in reply

    # Test safety confirmation prompt
    reply = resolve_control_voice_intent("shut down the PC", mock_gateway, "dev-1")
    assert "confirm shutdown" in reply


def test_oracle_system_lifecycle_controls(temp_db):
    cm = ControlManager(temp_db)
    # Check capabilities
    caps = cm.get_capabilities()
    assert "canControlOracleSystem" in caps

    # Check state snapshot contains oracle_system
    state = cm.get_state()
    assert "oracle_system" in state
    assert "running" in state["oracle_system"]
    assert "status" in state["oracle_system"]

    # Dispatch status check
    res = cm.dispatch_internal("system.oracle_status", {})
    assert "running" in res

    # Mock start and stop
    with patch.object(cm.oracle_system, "start_system", return_value={"status": "accepted", "running": True}) as mock_start:
        res_start = cm.handle_command("dev-1", "system.oracle_start", {})
        assert res_start["status"] == "completed"
        assert res_start["result"]["running"] is True
        mock_start.assert_called_once()

    with patch.object(cm.oracle_system, "stop_system", return_value={"status": "completed", "running": False}) as mock_stop:
        res_stop = cm.handle_command("dev-1", "system.oracle_stop", {})
        assert res_stop["status"] == "completed"
        assert res_stop["result"]["running"] is False
        mock_stop.assert_called_once()

    cm.scheduler.stop()

