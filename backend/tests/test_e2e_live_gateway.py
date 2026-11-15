"""End-to-end integration test running a live ThreadingHTTPServer for Companion Remote Controls."""
import base64
import json
import socket
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path
import pytest

from app.companion_gateway import Gateway, Handler, ThreadingHTTPServer, PREFIX


class QuietHandler(Handler):
    def log_message(self, format, *args):
        pass


@pytest.fixture
def live_gateway_server(tmp_path):
    # Setup temporary gateway environment
    state_dir = tmp_path / "companion_state"
    state_dir.mkdir(parents=True, exist_ok=True)
    gateway = Gateway(state_dir, tmp_path)

    # Bind on ephemeral port
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    server.gateway = gateway
    server.transport = "lan"
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # Create a test paired device
    code = gateway.issue()
    pair_res = gateway.pair(code, "Test Pixel Phone")
    token = pair_res["token"]

    base_url = f"http://127.0.0.1:{port}{PREFIX}"

    yield {"base_url": base_url, "token": token, "gateway": gateway, "port": port}

    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def http_req(url, token, method="GET", body=None, content_type="application/json"):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
        "Connection": "close",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8") if isinstance(body, dict) else body

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=12) as resp:
        return resp.status, resp.headers, resp.read()


def test_e2e_live_gateway_remote_controls(live_gateway_server):
    base_url = live_gateway_server["base_url"]
    token = live_gateway_server["token"]

    # 1. Capabilities
    status, headers, body = http_req(f"{base_url}/controls/capabilities", token)
    assert status == 200
    caps = json.loads(body.decode("utf-8"))
    assert caps["supported"] is True
    assert caps["canLock"] is True
    assert caps["canControlMasterVolume"] is True

    # 2. Controls State (micro-cached)
    status, headers, body = http_req(f"{base_url}/controls/state", token)
    assert status == 200
    state = json.loads(body.decode("utf-8"))
    assert state["supported"] is True
    assert "volume" in state
    assert "uptime" in state

    # 3. Routines
    status, headers, body = http_req(f"{base_url}/controls/routines", token)
    assert status == 200
    routines_data = json.loads(body.decode("utf-8"))
    assert "routines" in routines_data
    routines = routines_data["routines"]
    assert isinstance(routines, list)
    assert len(routines) >= 4
    routine_ids = [r["id"] for r in routines]
    assert "builtin_study_mode" in routine_ids
    assert "builtin_presentation_mode" in routine_ids

    # 4. Screen Frame
    from app import companion_windows
    companion_windows.set_screen_sharing(True)
    try:
        status, headers, body = http_req(f"{base_url}/controls/screen/frame", token)
        assert status == 200
        frame_res = json.loads(body.decode("utf-8"))
        assert frame_res["active"] is True
        assert "image" in frame_res
        frame_bytes = base64.b64decode(frame_res["image"])
        assert frame_bytes.startswith(b"\xff\xd8")  # Valid JPEG SOI marker
    finally:
        companion_windows.set_screen_sharing(False)

    # 5. Schedules
    status, headers, body = http_req(f"{base_url}/controls/schedules", token)
    assert status == 200
    sched_data = json.loads(body.decode("utf-8"))
    assert "active" in sched_data
    assert isinstance(sched_data["active"], list)
    assert "history" in sched_data

    # 6. Clipboard
    status, headers, body = http_req(f"{base_url}/controls/clipboard", token)
    assert status == 200
    clip = json.loads(body.decode("utf-8"))
    assert "text" in clip

    # 7. Command Execution with Idempotency request_id
    req_id = "req_test_dedup_001"
    command_payload = {
        "action": "stay_awake",
        "parameters": {"minutes": 5},
        "request_id": req_id,
    }
    status, headers, body = http_req(
        f"{base_url}/controls/commands", token, method="POST", body=command_payload
    )
    assert status == 200
    cmd_res = json.loads(body.decode("utf-8"))
    assert cmd_res["status"] == "completed"
    cmd_id = cmd_res["command_id"]
    assert len(cmd_id) > 10

    # Repeat exact same request_id -> Should return cached deduplicated result instantly
    status2, headers2, body2 = http_req(
        f"{base_url}/controls/commands", token, method="POST", body=command_payload
    )
    assert status2 == 200
    cmd_res2 = json.loads(body2.decode("utf-8"))
    assert cmd_res2["command_id"] == cmd_id
    assert cmd_res2.get("duplicate") is True

    # 8. Command Status Query
    status, headers, body = http_req(f"{base_url}/controls/commands/{cmd_id}", token)
    assert status == 200
    status_res = json.loads(body.decode("utf-8"))
    assert status_res["command_id"] == cmd_id
    assert status_res["status"] == "completed"

    # Cleanup stay-awake
    cancel_payload = {
        "action": "cancel_stay_awake",
        "parameters": {},
        "request_id": "req_test_cleanup_001",
    }
    http_req(f"{base_url}/controls/commands", token, method="POST", body=cancel_payload)
