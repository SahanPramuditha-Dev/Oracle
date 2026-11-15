"""Command Registry, Capability Detection, and State Manager for Oracle Central and Companion.

Orchestrates:
- Unified command dispatch with strict parameter validation and idempotency.
- Lifecycle tracking: created -> validated -> accepted -> executing -> completed / failed / rejected.
- Comprehensive hardware & OS capability detection.
- Authoritative PC state snapshot generation with revision sequencing.
- Integration of Power, Audio, Media, Display, Application, Input, Scheduler, and Routines.
"""

import json
import logging
import sqlite3
import sys
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

from .control_adapters import (
    ApplicationControlAdapter,
    AudioControlAdapter,
    DisplayControlAdapter,
    InputControlAdapter,
    MediaControlAdapter,
    OracleSystemControlAdapter,
    PowerControlAdapter,
    ScreenPreviewAdapter,
    WakeOnLanAdapter,
)
from .control_routines import RoutineEngine
from .control_scheduler import ControlScheduler

logger = logging.getLogger(__name__)


class ControlManager:
    def __init__(self, db_factory: Callable[[], sqlite3.Connection], desktop_actions=None):
        self.db_factory = db_factory
        self.desktop_actions = desktop_actions
        self._revision = 1
        self._lock = threading.Lock()

        # Initialize adapters
        self.power = PowerControlAdapter()
        self.audio = AudioControlAdapter()
        self.media = MediaControlAdapter()
        self.display = DisplayControlAdapter()
        self.apps = ApplicationControlAdapter(desktop_actions=desktop_actions)
        self.input = InputControlAdapter()
        self.screen = ScreenPreviewAdapter()
        self.wol = WakeOnLanAdapter()
        self.oracle_system = OracleSystemControlAdapter()

        self._init_db()

        # Initialize scheduler and routines
        self.scheduler = ControlScheduler(db_factory, self.dispatch_internal)
        self.routines = RoutineEngine(db_factory, self.dispatch_internal)
        self.scheduler.start()

    def _init_db(self):
        with self.db_factory() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS control_commands (
                    id TEXT PRIMARY KEY,
                    request_id TEXT UNIQUE,
                    device_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    parameters TEXT NOT NULL,
                    status TEXT NOT NULL, -- 'accepted', 'executing', 'completed', 'failed', 'rejected'
                    accepted_at INTEGER NOT NULL,
                    completed_at INTEGER,
                    result TEXT,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS control_activity (
                    id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_activity_time ON control_activity(timestamp DESC);
            """)

    def bump_revision(self):
        with self._lock:
            self._revision += 1

    # ==========================================================================
    # CAPABILITY DETECTION
    # ==========================================================================
    def get_capabilities(self) -> Dict[str, Any]:
        """Discovers actual PC hardware and software capabilities."""
        is_windows = sys.platform == "win32"
        brightness_info = self.display.get_brightness()
        vol_info = self.audio.get_master_volume()
        mic_info = self.audio.get_microphone()
        wol_adapters = self.wol.get_mac_addresses()

        can_sleep = self.power.can_sleep()
        can_hibernate = self.power.can_hibernate()
        can_brightness = brightness_info.get("supported", False)

        unsupported_reasons = {}
        if not is_windows:
            unsupported_reasons["platform"] = "Remote controls require a Windows operating system host."
        if not can_sleep:
            unsupported_reasons["power.sleep"] = "Windows reports system sleep is disabled by policy or hardware."
        if not can_hibernate:
            unsupported_reasons["power.hibernate"] = "Hibernation is not enabled on this PC."
        if not can_brightness:
            unsupported_reasons["display.brightness"] = brightness_info.get("reason", "Display does not support WMI brightness (external desktop monitor).")

        return {
            "platform": sys.platform,
            "canSleep": can_sleep,
            "canHibernate": can_hibernate,
            "canShutdown": is_windows,
            "canRestart": is_windows,
            "canLock": is_windows,
            "canTurnOffDisplay": is_windows,
            "canStayAwake": is_windows,
            "canControlMasterVolume": vol_info.get("supported", False),
            "canControlMic": mic_info.get("supported", False),
            "canControlAppMixer": is_windows,
            "canControlBrightness": can_brightness,
            "canManageWindows": is_windows,
            "canSendRemoteInput": is_windows,
            "canShareScreen": is_windows,
            "canScheduleActions": True,
            "canRunRoutines": True,
            "canControlOracleSystem": is_windows,
            "wakeOnLanConfigured": len(wol_adapters) > 0,
            "macAddresses": wol_adapters,
            "unsupportedReasons": unsupported_reasons
        }

    # ==========================================================================
    # AUTHORITATIVE PC STATE SNAPSHOT
    # ==========================================================================
    def get_state(self) -> Dict[str, Any]:
        """Returns the live authoritative PC state snapshot."""
        power_status = self.power.get_status()
        master_vol = self.audio.get_master_volume()
        mic = self.audio.get_microphone()
        now_playing = self.media.get_now_playing()
        brightness = self.display.get_brightness()
        display_info = self.display.get_display_info()
        running_apps = self.apps.list_running_applications()
        active_routine = self.routines.get_active_routine()
        pending_schedules = self.scheduler.list_schedules(status="pending")

        # Find next scheduled execution
        next_schedule = pending_schedules[0] if pending_schedules else None

        with self._lock:
            rev = self._revision

        return {
            "revision": rev,
            "timestamp": int(time.time()),
            "power": {
                "battery": power_status.get("battery"),
                "uptime_seconds": power_status.get("uptime_seconds", 0),
                "stay_awake": power_status.get("stay_awake"),
                "can_sleep": power_status.get("can_sleep", False),
                "can_hibernate": power_status.get("can_hibernate", False)
            },
            "audio": {
                "volume": master_vol.get("percent", 50),
                "muted": master_vol.get("muted", False),
                "microphone": mic,
                "output_devices": self.audio.get_output_devices(),
                "app_mixer": self.audio.get_app_mixer()
            },
            "media": now_playing,
            "display": {
                "brightness": brightness.get("brightness", 100),
                "brightness_supported": brightness.get("supported", False),
                "info": display_info
            },
            "applications": {
                "count": len(running_apps),
                "windows": running_apps[:25]
            },
            "schedules": {
                "pending_count": len(pending_schedules),
                "next": next_schedule
            },
            "active_routine": active_routine,
            "oracle_system": self.oracle_system.get_status()
        }

    # ==========================================================================
    # COMMAND REGISTRY & DISPATCH
    # ==========================================================================
    def handle_command(self, device_id: str, action: str, parameters: Dict[str, Any], request_id: Optional[str] = None) -> Dict[str, Any]:
        """Accepts, validates, executes, and records a remote control command."""
        now = int(time.time())
        cmd_id = str(uuid.uuid4())
        req_id = request_id or str(uuid.uuid4())

        # Check idempotency
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            existing = db.execute("SELECT * FROM control_commands WHERE request_id=?", (req_id,)).fetchone()
            if existing:
                res = {}
                try:
                    res = json.loads(existing["result"] or "{}")
                except Exception:
                    pass
                return {
                    "command_id": existing["id"],
                    "status": existing["status"],
                    "accepted_at": existing["accepted_at"],
                    "completed_at": existing["completed_at"],
                    "result": res,
                    "error": existing["error"]
                }

            # Record acceptance
            db.execute("""
                INSERT INTO control_commands (id, request_id, device_id, action, parameters, status, accepted_at)
                VALUES (?, ?, ?, ?, ?, 'accepted', ?)
            """, (cmd_id, req_id, device_id, action, json.dumps(parameters or {}), now))

        # Execute
        try:
            with self.db_factory() as db:
                db.execute("UPDATE control_commands SET status='executing' WHERE id=?", (cmd_id,))

            result = self.dispatch_internal(action, parameters or {})
            self.bump_revision()

            finish_time = int(time.time())
            with self.db_factory() as db:
                db.execute("""
                    UPDATE control_commands
                    SET status='completed', completed_at=?, result=?
                    WHERE id=?
                """, (finish_time, json.dumps(result), cmd_id))
                db.execute("""
                    INSERT INTO control_activity (id, device_id, action, status, message, timestamp)
                    VALUES (?, ?, ?, 'completed', ?, ?)
                """, (str(uuid.uuid4()), device_id, action, result.get("message", "Completed."), finish_time))

            return {
                "command_id": cmd_id,
                "status": "completed",
                "accepted_at": now,
                "completed_at": finish_time,
                "result": result
            }
        except Exception as e:
            logger.error("Command execution error for '%s': %s", action, e)
            finish_time = int(time.time())
            error_msg = str(e)
            with self.db_factory() as db:
                db.execute("""
                    UPDATE control_commands
                    SET status='failed', completed_at=?, error=?
                    WHERE id=?
                """, (finish_time, error_msg, cmd_id))
                db.execute("""
                    INSERT INTO control_activity (id, device_id, action, status, message, timestamp)
                    VALUES (?, ?, ?, 'failed', ?, ?)
                """, (str(uuid.uuid4()), device_id, action, error_msg, finish_time))

            return {
                "command_id": cmd_id,
                "status": "failed",
                "accepted_at": now,
                "completed_at": finish_time,
                "error": error_msg
            }

    def dispatch_internal(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Internal router calling appropriate control adapters."""
        act = action.lower().strip()

        # --- Power Control ---
        if act == "power.lock":
            return self.power.lock()
        elif act == "power.sleep":
            return self.power.sleep()
        elif act == "power.hibernate":
            return self.power.hibernate()
        elif act == "power.shutdown":
            force = bool(params.get("force", False))
            return self.power.shutdown(force=force)
        elif act == "power.restart":
            force = bool(params.get("force", False))
            return self.power.restart(force=force)
        elif act == "power.sign_out":
            return self.power.sign_out()
        elif act == "power.turn_off_display":
            return self.power.turn_off_display()
        elif act == "power.stay_awake":
            duration = int(params.get("duration_seconds", 3600))
            keep_display = bool(params.get("keep_display", True))
            return self.power.stay_awake(duration_seconds=duration, keep_display=keep_display)
        elif act == "power.cancel_stay_awake":
            return self.power.cancel_stay_awake()

        # --- Audio Control ---
        elif act == "audio.set_volume":
            percent = int(params["percent"])
            return self.audio.set_master_volume(percent)
        elif act == "audio.mute":
            muted = bool(params.get("muted", True))
            return self.audio.set_mute(muted)
        elif act == "audio.set_mic_volume":
            percent = int(params["percent"])
            return self.audio.set_microphone_volume(percent)
        elif act == "audio.set_mic_mute":
            muted = bool(params.get("muted", True))
            return self.audio.set_microphone_mute(muted)
        elif act == "audio.set_app_volume":
            pid = int(params["pid"])
            percent = int(params["percent"])
            return self.audio.set_app_volume(pid, percent)
        elif act == "audio.set_app_mute":
            pid = int(params["pid"])
            muted = bool(params.get("muted", True))
            return self.audio.set_app_mute(pid, muted)

        # --- Media Control ---
        elif act in ("media.play_pause", "media.play", "media.pause"):
            return self.media.control("play_pause")
        elif act in ("media.next", "media.next_track"):
            return self.media.control("next")
        elif act in ("media.prev", "media.previous", "media.prev_track"):
            return self.media.control("prev")
        elif act == "media.stop":
            return self.media.control("stop")

        # --- Display Control ---
        elif act == "display.set_brightness":
            percent = int(params["percent"])
            return self.display.set_brightness(percent)
        elif act == "display.turn_off":
            return self.power.turn_off_display()

        # --- Applications Control ---
        elif act == "apps.launch":
            app_id = str(params["app_id"])
            return self.apps.launch_approved_app(app_id)
        elif act == "apps.window_state":
            hwnd = int(params["hwnd"])
            state = str(params["state"])
            return self.apps.set_window_state(hwnd, state)
        elif act == "apps.terminate":
            pid = int(params["pid"])
            force = bool(params.get("force", True))
            return self.apps.terminate_process(pid, force=force)

        # --- Input Control ---
        elif act == "input.mouse_move":
            dx = int(params.get("dx", 0))
            dy = int(params.get("dy", 0))
            sens = float(params.get("sensitivity", 1.0))
            return self.input.mouse_move(dx, dy, sens)
        elif act == "input.mouse_click":
            btn = str(params.get("button", "left"))
            dbl = bool(params.get("double", False))
            return self.input.mouse_click(button=btn, double=dbl)
        elif act == "input.mouse_down":
            btn = str(params.get("button", "left"))
            return self.input.mouse_down(button=btn)
        elif act == "input.mouse_up":
            btn = str(params.get("button", "left"))
            return self.input.mouse_up(button=btn)
        elif act == "input.mouse_scroll":
            dy = int(params.get("dy", 0))
            return self.input.mouse_scroll(dy)
        elif act == "input.type_text":
            text = str(params.get("text", ""))
            return self.input.keyboard_type(text)
        elif act == "input.key":
            key = str(params["key"])
            return self.input.keyboard_key(key)
        elif act == "input.presentation":
            cmd = str(params["command"])
            return self.input.presentation_control(cmd)
        elif act == "clipboard.set":
            text = str(params.get("text", ""))
            return self.input.clipboard_set(text)
        elif act == "clipboard.clear":
            return self.input.clipboard_clear()

        # --- Wake-on-LAN ---
        elif act == "wol.wake":
            mac = str(params["mac"])
            bcast = str(params.get("ip", "255.255.255.255"))
            port = int(params.get("port", 9))
            return self.wol.send_magic_packet(mac, bcast, port)

        # --- Oracle AI System Lifecycle ---
        elif act in ("system.oracle_start", "system.start_oracle"):
            return self.oracle_system.start_system()
        elif act in ("system.oracle_stop", "system.stop_oracle"):
            return self.oracle_system.stop_system()
        elif act in ("system.oracle_restart", "system.restart_oracle"):
            return self.oracle_system.restart_system()
        elif act in ("system.oracle_status", "system.status_oracle"):
            return self.oracle_system.get_status()

        else:
            raise ValueError(f"Unknown or unsupported control action: {action}")

    # ==========================================================================
    # ACTIVITY HISTORY
    # ==========================================================================
    def list_activity(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute(
                "SELECT * FROM control_activity ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]
