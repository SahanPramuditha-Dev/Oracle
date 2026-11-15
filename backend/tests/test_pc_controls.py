"""Unit and integration tests for Oracle Companion PC Remote Control system."""
import os
import time
import pytest
from app import companion_windows
from app.companion_scheduler import CompanionScheduler
from app.companion_routines import RoutineEngine
from app.companion_gateway import Gateway, Problem


@pytest.fixture
def mock_db_factory(tmp_path):
    import sqlite3
    db_file = tmp_path / "test_controls.db"

    def _get_db():
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        return conn

    return _get_db


def test_capabilities_structure(tmp_path):
    gateway = Gateway(tmp_path / "state", tmp_path)
    caps = gateway.device_capabilities()
    assert "supported" in caps
    if os.name == "nt":
        assert caps["supported"] is True
        assert caps["os"] == "Windows"
        assert "canLock" in caps
        assert "canShutdown" in caps
        assert "canControlMasterVolume" in caps
        assert "canControlMediaSessions" in caps
        assert "canSendRemoteInput" in caps
        assert "canScheduleActions" in caps
        assert "canRunRoutines" in caps


def test_controls_state_structure(tmp_path):
    gateway = Gateway(tmp_path / "state", tmp_path)
    state = gateway.controls_state()
    assert "supported" in state
    if os.name == "nt":
        assert state["supported"] is True
        assert "uptime" in state
        assert "volume" in state
        assert "microphone" in state
        assert "media" in state
        assert "scheduled" in state


def test_stay_awake_lifecycle():
    if os.name != "nt":
        pytest.skip("Windows only")
    # Activate stay awake for 10 minutes
    res = companion_windows.stay_awake(duration_minutes=10)
    assert res["active"] is True
    assert res["remaining_seconds"] > 0

    status = companion_windows.get_stay_awake_status()
    assert status["active"] is True

    # Cancel stay awake
    cancelled = companion_windows.stay_awake(cancel=True)
    assert cancelled["active"] is False

    status_after = companion_windows.get_stay_awake_status()
    assert status_after["active"] is False


def test_master_volume_control():
    if os.name != "nt":
        pytest.skip("Windows only")
    vol_info = companion_windows.get_master_volume()
    assert "percent" in vol_info
    assert "muted" in vol_info
    assert 0 <= vol_info["percent"] <= 100

    # Test setting volume within safe range
    orig = vol_info["percent"]
    try:
        set_res = companion_windows.set_master_volume(35)
        assert set_res["status"] == "ok"
        assert set_res["percent"] == 35
    finally:
        companion_windows.set_master_volume(orig)


def test_protected_process_termination():
    if os.name != "nt":
        pytest.skip("Windows only")
    # Find python or explorer pid
    import psutil
    cur_pid = os.getpid()
    with pytest.raises(RuntimeError, match="protected from termination"):
        companion_windows.terminate_application(cur_pid)


def test_clipboard_operations():
    res = companion_windows.write_clipboard("Oracle Test Clipboard")
    assert res["status"] == "ok"

    read_res = companion_windows.read_clipboard()
    assert read_res["text"] == "Oracle Test Clipboard"

    clear_res = companion_windows.clear_clipboard()
    assert clear_res["status"] == "ok"
    assert companion_windows.read_clipboard()["text"] == ""


def test_wol_magic_packet():
    # Valid MAC formatting
    res = companion_windows.send_wol_packet("68:34:21:6C:CA:E1")
    assert res["status"] == "ok"
    assert res["mac"] == "68:34:21:6C:CA:E1"

    # Invalid MAC should raise ValueError
    with pytest.raises(ValueError):
        companion_windows.send_wol_packet("invalid-mac")


def test_scheduler_lifecycle(mock_db_factory):
    executed = []

    def mock_action(action, owner):
        executed.append((action, owner))
        return {"status": "ok", "message": f"{action} done"}

    scheduler = CompanionScheduler(mock_db_factory, mock_action)

    # 1. Create countdown schedule
    sched = scheduler.create_schedule(
        action="shutdown", mode="countdown", minutes=30, owner="device-1"
    )
    assert sched["status"] == "pending"
    assert sched["due"] > time.time()

    # 2. List schedules
    schedules = scheduler.list_schedules(include_history=True)
    assert len(schedules["active"]) == 1
    assert schedules["active"][0]["id"] == sched["id"]

    # 3. Next action
    next_act = scheduler.get_next_scheduled_action()
    assert next_act["id"] == sched["id"]

    # 4. Cancel schedule
    cancel_res = scheduler.cancel_schedule(sched["id"])
    assert cancel_res["status"] == "ok"

    schedules_after = scheduler.list_schedules(include_history=True)
    assert len(schedules_after["active"]) == 0
    assert len(schedules_after["history"]) >= 1


def test_routine_engine(mock_db_factory):
    dispatched = []

    def mock_dispatch(action, params, owner):
        dispatched.append((action, params))
        return {"status": "ok", "action": action}

    engine = RoutineEngine(mock_db_factory, mock_dispatch)

    routines = engine.list_routines()
    assert len(routines) >= 4 # Built-in default routines

    study_mode = next(r for r in routines if r["id"] == "builtin_study_mode")
    assert len(study_mode["actions"]) >= 3

    # Execute study mode routine
    result = engine.execute_routine("builtin_study_mode", owner="test-phone")
    assert result["status"] == "completed"
    assert len(result["steps"]) == len(study_mode["actions"])
    assert len(dispatched) == len(study_mode["actions"])

    history = engine.get_history()
    assert len(history) >= 1
    assert history[0]["routine_id"] == "builtin_study_mode"


def test_gateway_command_execution(tmp_path):
    gateway = Gateway(tmp_path / "state", tmp_path)
    # Register device
    with gateway.db() as db:
        db.execute("INSERT INTO devices VALUES ('test-hash', 'dev-1', 'Pixel')")

    if os.name == "nt":
        # Test valid command
        cmd_res = gateway.execute_control_command("dev-1", "audio.volume_up", {})
        assert cmd_res["status"] == "completed"
        assert "command_id" in cmd_res

        # Test command deduplication with request_id
        req_id = "test-request-uuid-12345"
        res1 = gateway.execute_control_command("dev-1", "audio.volume_up", {}, request_id=req_id)
        assert res1["status"] == "completed"
        assert res1.get("duplicate") is not True

        # Second call with same request_id should be recognized as duplicate
        res2 = gateway.execute_control_command("dev-1", "audio.volume_up", {}, request_id=req_id)
        assert res2["status"] == "completed"
        assert res2["command_id"] == res1["command_id"]
        assert res2.get("duplicate") is True

        # Test unknown command
        with pytest.raises(Problem):
            gateway.execute_control_command("dev-1", "unknown.invalid_action", {})


def test_screen_preview_lifecycle():
    if os.name != "nt":
        pytest.skip("Windows only")

    from app import companion_windows
    # Inactive screen preview
    companion_windows.set_screen_sharing(False)
    inactive_res = companion_windows.capture_screen_frame()
    assert inactive_res["active"] is False
    assert "error" in inactive_res

    # Active screen preview
    companion_windows.set_screen_sharing(True)
    try:
        active_res = companion_windows.capture_screen_frame(quality=40, max_width=480)
        assert active_res["active"] is True
        assert "image" in active_res
        assert len(active_res["image"]) > 100
        assert active_res["width"] <= 480
    finally:
        companion_windows.set_screen_sharing(False)

