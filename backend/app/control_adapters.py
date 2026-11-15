"""Windows System Control Adapters for Oracle Central and Companion.

Provides isolated adapters for:
- PowerControl: Lock, Sleep, Hibernate, Shutdown, Restart, Sign Out, Display Off, Stay Awake, Battery/Power status.
- AudioControl: Master volume, Mute, Playback devices, Microphone, Application Volume Mixer.
- MediaControl: Multimedia keys (Play/Pause, Next, Prev, Stop), active sessions.
- DisplayControl: Brightness (WMI), Display Off, Resolution/Monitors.
- ApplicationControl: Running windows/apps, Window state (focus, min, max, restore, close), Process termination with safeguards, App launcher.
- InputControl: Mouse trackpad events (move, click, scroll, drag), Keyboard events (text, hotkeys), Clipboard sharing.
- ScreenPreview: Capture frame thumbnails (JPEG) for live remote preview.
- WakeOnLan: Adapter MAC detection and magic packet dispatch.
"""

import ctypes
import io
import json
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# --- Windows Native Types and Constants ---
if sys.platform == "win32":
    import win32api
    import win32con
    import win32gui
    import win32process
    import psutil
    import pyperclip
    from PIL import Image
    try:
        from pycaw.pycaw import AudioUtilities
    except Exception:
        AudioUtilities = None
else:
    win32api = win32con = win32gui = win32process = psutil = pyperclip = Image = AudioUtilities = None

# Thread Execution State flags (for Stay Awake)
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002

# Mouse and Keyboard Event Flags
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_HWHEEL = 0x1000

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF

# Critical processes that must NEVER be terminated by remote control
PROTECTED_PROCESSES = {
    "system", "system idle process", "smss.exe", "csrss.exe", "wininit.exe",
    "services.exe", "lsass.exe", "svchost.exe", "fontdrvhost.exe", "dwm.exe",
    "winlogon.exe", "explorer.exe", "spoolsv.exe", "taskhostw.exe", "sihost.exe",
    "runtimebroker.exe", "ctfmon.exe", "securityhealthservice.exe", "python.exe",
    "pythonw.exe", "oracle.exe"
}


# ==============================================================================
# 1. POWER CONTROL ADAPTER
# ==============================================================================
class PowerControlAdapter:
    def __init__(self):
        self._stay_awake_timer: Optional[threading.Timer] = None
        self._stay_awake_until: float = 0.0
        self._stay_awake_lock = threading.Lock()

    def lock(self) -> Dict[str, Any]:
        """Locks the active Windows workstation."""
        if sys.platform != "win32":
            raise RuntimeError("Lock is only supported on Windows.")
        ok = ctypes.windll.user32.LockWorkStation()
        if not ok:
            raise RuntimeError("Windows rejected the workstation lock request.")
        return {"status": "completed", "message": "Windows workstation locked."}

    def sleep(self) -> Dict[str, Any]:
        """Requests Windows to enter sleep state."""
        if sys.platform != "win32":
            raise RuntimeError("Sleep is only supported on Windows.")
        if not self.can_sleep():
            raise RuntimeError("Sleep is not supported or is disabled on this PC.")
        # SetSuspendState(bHibernate=0, bForce=0, bWakeupEventsDisabled=0)
        # Run in a detached thread with a brief delay so the API response completes first
        def _do_sleep():
            time.sleep(0.5)
            try:
                ctypes.windll.PowrProf.SetSuspendState(0, 0, 0)
            except Exception as e:
                logger.error("SetSuspendState sleep failed: %s", e)

        t = threading.Thread(target=_do_sleep, daemon=True)
        t.start()
        return {"status": "accepted", "message": "Sleep request dispatched to Windows."}

    def hibernate(self) -> Dict[str, Any]:
        """Requests Windows to enter hibernation state."""
        if sys.platform != "win32":
            raise RuntimeError("Hibernate is only supported on Windows.")
        if not self.can_hibernate():
            raise RuntimeError("Hibernation is not enabled or supported on this PC.")

        def _do_hibernate():
            time.sleep(0.5)
            try:
                ctypes.windll.PowrProf.SetSuspendState(1, 0, 0)
            except Exception as e:
                logger.error("SetSuspendState hibernate failed: %s", e)

        t = threading.Thread(target=_do_hibernate, daemon=True)
        t.start()
        return {"status": "accepted", "message": "Hibernate request dispatched to Windows."}

    def shutdown(self, force: bool = False) -> Dict[str, Any]:
        """Safely shuts down the PC."""
        if sys.platform != "win32":
            raise RuntimeError("Shutdown is only supported on Windows.")
        sys_root = os.environ.get("SystemRoot", r"C:\Windows")
        binary = os.path.join(sys_root, "System32", "shutdown.exe")
        args = [binary, "/s", "/t", "0"]
        if force:
            args.append("/f")

        def _do_shutdown():
            time.sleep(0.5)
            try:
                subprocess.run(args, capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            except Exception as e:
                logger.error("Shutdown execution failed: %s", e)

        t = threading.Thread(target=_do_shutdown, daemon=True)
        t.start()
        return {"status": "accepted", "message": "Shutdown request dispatched to Windows."}

    def restart(self, force: bool = False) -> Dict[str, Any]:
        """Safely restarts the PC."""
        if sys.platform != "win32":
            raise RuntimeError("Restart is only supported on Windows.")
        sys_root = os.environ.get("SystemRoot", r"C:\Windows")
        binary = os.path.join(sys_root, "System32", "shutdown.exe")
        args = [binary, "/r", "/t", "0"]
        if force:
            args.append("/f")

        def _do_restart():
            time.sleep(0.5)
            try:
                subprocess.run(args, capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            except Exception as e:
                logger.error("Restart execution failed: %s", e)

        t = threading.Thread(target=_do_restart, daemon=True)
        t.start()
        return {"status": "accepted", "message": "Restart request dispatched to Windows."}

    def sign_out(self) -> Dict[str, Any]:
        """Signs out the active interactive Windows user."""
        if sys.platform != "win32":
            raise RuntimeError("Sign out is only supported on Windows.")
        sys_root = os.environ.get("SystemRoot", r"C:\Windows")
        binary = os.path.join(sys_root, "System32", "shutdown.exe")

        def _do_sign_out():
            time.sleep(0.5)
            try:
                subprocess.run([binary, "/l"], capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            except Exception as e:
                logger.error("Sign out execution failed: %s", e)

        t = threading.Thread(target=_do_sign_out, daemon=True)
        t.start()
        return {"status": "accepted", "message": "Sign out request dispatched to Windows."}

    def turn_off_display(self) -> Dict[str, Any]:
        """Puts connected display(s) to sleep while PC remains running."""
        if sys.platform != "win32":
            raise RuntimeError("Turn display off is only supported on Windows.")
        try:
            # SendMessage(HWND_BROADCAST=0xFFFF, WM_SYSCOMMAND=0x0112, SC_MONITORPOWER=0xF170, 2)
            ctypes.windll.user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
            return {"status": "completed", "message": "Display low-power sleep command dispatched."}
        except Exception as e:
            raise RuntimeError(f"Could not turn display off: {e}")

    def stay_awake(self, duration_seconds: int = 3600, keep_display: bool = True) -> Dict[str, Any]:
        """Prevents Windows from entering sleep for duration_seconds."""
        if sys.platform != "win32":
            raise RuntimeError("Stay awake is only supported on Windows.")
        with self._stay_awake_lock:
            if self._stay_awake_timer:
                self._stay_awake_timer.cancel()
                self._stay_awake_timer = None

            flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED
            if keep_display:
                flags |= ES_DISPLAY_REQUIRED

            ctypes.windll.kernel32.SetThreadExecutionState(flags)
            self._stay_awake_until = time.time() + duration_seconds

            def _expire():
                with self._stay_awake_lock:
                    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
                    self._stay_awake_timer = None
                    self._stay_awake_until = 0.0
                    logger.info("Stay awake expired; normal sleep policy restored.")

            self._stay_awake_timer = threading.Timer(duration_seconds, _expire)
            self._stay_awake_timer.daemon = True
            self._stay_awake_timer.start()

            return {
                "status": "completed",
                "message": f"Stay awake active for {duration_seconds // 60} minutes.",
                "expires_at": int(self._stay_awake_until),
                "remaining_seconds": duration_seconds
            }

    def cancel_stay_awake(self) -> Dict[str, Any]:
        """Cancels stay awake mode and restores normal Windows sleep."""
        if sys.platform != "win32":
            return {"status": "completed", "message": "Stay awake not active."}
        with self._stay_awake_lock:
            if self._stay_awake_timer:
                self._stay_awake_timer.cancel()
                self._stay_awake_timer = None
            self._stay_awake_until = 0.0
            ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
            return {"status": "completed", "message": "Normal sleep policy restored."}

    def stay_awake_status(self) -> Dict[str, Any]:
        with self._stay_awake_lock:
            active = self._stay_awake_until > time.time()
            remaining = max(0, int(self._stay_awake_until - time.time())) if active else 0
            return {
                "active": active,
                "remaining_seconds": remaining,
                "expires_at": int(self._stay_awake_until) if active else None
            }

    def get_status(self) -> Dict[str, Any]:
        """Gets battery and uptime power info."""
        battery_info = None
        if sys.platform == "win32":
            try:
                class SYSTEM_POWER_STATUS(ctypes.Structure):
                    _fields_ = [
                        ("ACLineStatus", ctypes.c_ubyte),
                        ("BatteryFlag", ctypes.c_ubyte),
                        ("BatteryLifePercent", ctypes.c_ubyte),
                        ("SystemStatusFlag", ctypes.c_ubyte),
                        ("BatteryLifeTime", ctypes.c_ulong),
                        ("BatteryFullLifeTime", ctypes.c_ulong)
                    ]
                status = SYSTEM_POWER_STATUS()
                if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):
                    if status.BatteryFlag != 255 and not (status.BatteryFlag & 128) and status.BatteryLifePercent <= 100:
                        battery_info = {
                            "percent": int(status.BatteryLifePercent),
                            "pluggedIn": status.ACLineStatus == 1,
                            "charging": bool(status.BatteryFlag & 8),
                            "source": "AC" if status.ACLineStatus == 1 else "Battery"
                        }
                    else:
                        battery_info = {
                            "percent": 100,
                            "pluggedIn": True,
                            "charging": False,
                            "source": "Desktop AC"
                        }
            except Exception:
                pass

        if not battery_info and psutil:
            try:
                batt = psutil.sensors_battery()
                if batt:
                    battery_info = {
                        "percent": round(batt.percent),
                        "pluggedIn": bool(batt.power_plugged),
                        "charging": bool(batt.power_plugged),
                        "source": "AC" if batt.power_plugged else "Battery"
                    }
            except Exception:
                pass

        uptime_seconds = 0
        if psutil:
            try:
                uptime_seconds = int(time.time() - psutil.boot_time())
            except Exception:
                pass

        return {
            "battery": battery_info or {"percent": 100, "pluggedIn": True, "charging": False, "source": "Desktop AC"},
            "uptime_seconds": uptime_seconds,
            "stay_awake": self.stay_awake_status(),
            "can_sleep": self.can_sleep(),
            "can_hibernate": self.can_hibernate()
        }

    def can_sleep(self) -> bool:
        if sys.platform != "win32":
            return False
        try:
            return bool(ctypes.windll.PowrProf.IsPwrSuspendAllowed())
        except Exception:
            return True

    def can_hibernate(self) -> bool:
        if sys.platform != "win32":
            return False
        try:
            return bool(ctypes.windll.PowrProf.IsPwrHibernateAllowed())
        except Exception:
            return False


# ==============================================================================
# 2. AUDIO CONTROL ADAPTER
# ==============================================================================
class AudioControlAdapter:
    def get_master_volume(self) -> Dict[str, Any]:
        """Returns master volume percent (0-100) and muted state."""
        if not AudioUtilities:
            return {"percent": 50, "muted": False, "supported": False}
        try:
            speakers = AudioUtilities.GetSpeakers()
            vol = round(float(speakers.volume_percent))
            muted = bool(speakers.EndpointVolume.GetMute())
            return {"percent": vol, "muted": muted, "supported": True}
        except Exception as e:
            logger.warning("Could not read master volume: %s", e)
            return {"percent": 50, "muted": False, "supported": False}

    def set_master_volume(self, percent: int) -> Dict[str, Any]:
        """Sets master volume percent (0-100). Unmutes automatically if previously muted."""
        if not AudioUtilities:
            raise RuntimeError("Audio control unavailable.")
        try:
            speakers = AudioUtilities.GetSpeakers()
            target = max(0, min(100, int(percent)))
            speakers.volume_percent = float(target)
            if speakers.EndpointVolume.GetMute():
                speakers.EndpointVolume.SetMute(0, None)
            return {"percent": target, "muted": False, "status": "completed"}
        except Exception as e:
            raise RuntimeError(f"Could not set volume: {e}")

    def set_mute(self, muted: bool) -> Dict[str, Any]:
        """Mutes or unmutes master audio."""
        if not AudioUtilities:
            raise RuntimeError("Audio control unavailable.")
        try:
            speakers = AudioUtilities.GetSpeakers()
            speakers.EndpointVolume.SetMute(1 if muted else 0, None)
            vol = round(float(speakers.volume_percent))
            return {"percent": vol, "muted": bool(muted), "status": "completed"}
        except Exception as e:
            raise RuntimeError(f"Could not set mute: {e}")

    def get_microphone(self) -> Dict[str, Any]:
        """Returns default microphone status and volume."""
        if not AudioUtilities:
            return {"supported": False}
        try:
            mic_dev = AudioUtilities.GetMicrophone()
            if not mic_dev:
                return {"supported": False, "name": "None"}
            mic = AudioUtilities.CreateDevice(mic_dev)
            vol = round(float(mic.volume_percent))
            muted = bool(mic.EndpointVolume.GetMute())
            return {
                "supported": True,
                "name": mic.FriendlyName,
                "percent": vol,
                "muted": muted
            }
        except Exception as e:
            logger.debug("Could not read microphone: %s", e)
            return {"supported": False, "name": "Unavailable"}

    def set_microphone_volume(self, percent: int) -> Dict[str, Any]:
        """Sets microphone input volume (0-100)."""
        if not AudioUtilities:
            raise RuntimeError("Microphone control unavailable.")
        try:
            mic_dev = AudioUtilities.GetMicrophone()
            mic = AudioUtilities.CreateDevice(mic_dev)
            target = max(0, min(100, int(percent)))
            mic.volume_percent = float(target)
            return {"percent": target, "muted": bool(mic.EndpointVolume.GetMute()), "status": "completed"}
        except Exception as e:
            raise RuntimeError(f"Could not set microphone volume: {e}")

    def set_microphone_mute(self, muted: bool) -> Dict[str, Any]:
        """Mutes or unmutes the microphone."""
        if not AudioUtilities:
            raise RuntimeError("Microphone control unavailable.")
        try:
            mic_dev = AudioUtilities.GetMicrophone()
            mic = AudioUtilities.CreateDevice(mic_dev)
            mic.EndpointVolume.SetMute(1 if muted else 0, None)
            return {"percent": round(float(mic.volume_percent)), "muted": bool(muted), "status": "completed"}
        except Exception as e:
            raise RuntimeError(f"Could not mute microphone: {e}")

    def get_output_devices(self) -> List[Dict[str, Any]]:
        """Lists active audio playback endpoint devices."""
        if not AudioUtilities:
            return []
        try:
            devices = AudioUtilities.GetAllDevices()
            active_devices = []
            for d in devices:
                try:
                    # state 1 is Active
                    if getattr(d, "state", None) == 1 or str(getattr(d, "state", "")).endswith("Active"):
                        active_devices.append({
                            "name": d.FriendlyName,
                            "id": d.id,
                            "is_default": False
                        })
                except Exception:
                    continue
            # Mark current default speakers
            try:
                def_spk = AudioUtilities.GetSpeakers()
                for item in active_devices:
                    if item["name"] == def_spk.FriendlyName:
                        item["is_default"] = True
            except Exception:
                pass
            return active_devices
        except Exception as e:
            logger.warning("Could not list audio devices: %s", e)
            return []

    def get_app_mixer(self) -> List[Dict[str, Any]]:
        """Lists active audio sessions per application with volume and mute."""
        if not AudioUtilities:
            return []
        try:
            sessions = AudioUtilities.GetAllSessions()
            app_sessions = []
            seen_pids = set()
            for s in sessions:
                try:
                    if s.Process and s.Process.pid not in seen_pids:
                        seen_pids.add(s.Process.pid)
                        name = s.Process.name()
                        vol = round(float(s.SimpleAudioVolume.GetMasterVolume() * 100))
                        muted = bool(s.SimpleAudioVolume.GetMute())
                        app_label = name.removesuffix(".exe").capitalize()
                        if "chrome" in name.lower():
                            app_label = "Google Chrome"
                        elif "spotify" in name.lower():
                            app_label = "Spotify"
                        elif "code" in name.lower():
                            app_label = "VS Code"
                        elif "msedge" in name.lower():
                            app_label = "Microsoft Edge"
                        app_sessions.append({
                            "pid": s.Process.pid,
                            "name": name,
                            "label": app_label,
                            "volume": vol,
                            "muted": muted
                        })
                except Exception:
                    continue
            return app_sessions
        except Exception as e:
            logger.warning("Could not list app mixer sessions: %s", e)
            return []

    def set_app_volume(self, pid: int, percent: int) -> Dict[str, Any]:
        """Sets individual application audio volume by PID."""
        if not AudioUtilities:
            raise RuntimeError("App mixer unavailable.")
        try:
            sessions = AudioUtilities.GetAllSessions()
            for s in sessions:
                if s.Process and s.Process.pid == pid:
                    target = max(0.0, min(1.0, float(percent) / 100.0))
                    s.SimpleAudioVolume.SetMasterVolume(target, None)
                    return {"pid": pid, "volume": percent, "status": "completed"}
            raise RuntimeError(f"No active audio session found for PID {pid}")
        except Exception as e:
            raise RuntimeError(f"Could not set app volume: {e}")

    def set_app_mute(self, pid: int, muted: bool) -> Dict[str, Any]:
        """Mutes or unmutes individual application audio session by PID."""
        if not AudioUtilities:
            raise RuntimeError("App mixer unavailable.")
        try:
            sessions = AudioUtilities.GetAllSessions()
            for s in sessions:
                if s.Process and s.Process.pid == pid:
                    s.SimpleAudioVolume.SetMute(1 if muted else 0, None)
                    return {"pid": pid, "muted": bool(muted), "status": "completed"}
            raise RuntimeError(f"No active audio session found for PID {pid}")
        except Exception as e:
            raise RuntimeError(f"Could not mute app: {e}")


# ==============================================================================
# 3. MEDIA CONTROL ADAPTER
# ==============================================================================
class MediaControlAdapter:
    def control(self, action: str) -> Dict[str, Any]:
        """Dispatches media playback key: play_pause, next, prev, stop."""
        if sys.platform != "win32":
            raise RuntimeError("Media control is only supported on Windows.")
        mapping = {
            "play_pause": VK_MEDIA_PLAY_PAUSE,
            "play": VK_MEDIA_PLAY_PAUSE,
            "pause": VK_MEDIA_PLAY_PAUSE,
            "next": VK_MEDIA_NEXT_TRACK,
            "prev": VK_MEDIA_PREV_TRACK,
            "previous": VK_MEDIA_PREV_TRACK,
            "stop": VK_MEDIA_STOP
        }
        vk = mapping.get(action.lower())
        if not vk:
            raise ValueError(f"Unknown media action: {action}")
        try:
            user32 = ctypes.windll.user32
            user32.keybd_event(vk, 0, 0, 0)
            user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
            return {"status": "completed", "action": action, "message": f"Dispatched {action} to Windows media."}
        except Exception as e:
            raise RuntimeError(f"Media key dispatch failed: {e}")

    def get_now_playing(self) -> Dict[str, Any]:
        """Returns detected media playback metadata."""
        # Detect playing application via open windows titles (e.g., Spotify, Chrome YouTube)
        detected_title = None
        detected_app = None
        if win32gui and psutil:
            try:
                def _check_window(hwnd, _):
                    nonlocal detected_title, detected_app
                    if not win32gui.IsWindowVisible(hwnd):
                        return True
                    title = win32gui.GetWindowText(hwnd).strip()
                    if not title:
                        return True
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    try:
                        pname = psutil.Process(pid).name().lower()
                        if "spotify" in pname:
                            if title and title != "Spotify Free" and title != "Spotify Premium" and title != "Spotify":
                                detected_title = title
                                detected_app = "Spotify"
                                return False
                        elif ("chrome" in pname or "msedge" in pname) and (" - YouTube" in title or " | YouTube Music" in title):
                            cleaned = title.replace(" - YouTube", "").replace(" | YouTube Music", "")
                            detected_title = cleaned
                            detected_app = "YouTube"
                            return False
                    except Exception:
                        pass
                    return True
                win32gui.EnumWindows(_check_window, None)
            except Exception:
                pass

        return {
            "title": detected_title or "Media Player",
            "artist": detected_app or "Windows Audio",
            "album": "",
            "is_playing": bool(detected_title),
            "source": detected_app or "Windows System"
        }


# ==============================================================================
# 4. DISPLAY CONTROL ADAPTER
# ==============================================================================
class DisplayControlAdapter:
    def get_brightness(self) -> Dict[str, Any]:
        """Gets current monitor brightness percent (0-100) via WMI."""
        if sys.platform != "win32":
            return {"supported": False, "brightness": 100}
        try:
            import win32com.client
            wmi = win32com.client.GetObject("winmgmts:\\\\.\\root\\wmi")
            monitors = wmi.InstancesOf("WmiMonitorBrightness")
            for m in monitors:
                if getattr(m, "Active", True):
                    return {
                        "supported": True,
                        "brightness": int(m.CurrentBrightness),
                        "instance": getattr(m, "InstanceName", "Primary")
                    }
            return {"supported": False, "brightness": 100, "reason": "No internal WMI-compatible monitor found (desktop external display)"}
        except Exception as e:
            return {"supported": False, "brightness": 100, "reason": str(e)}

    def set_brightness(self, percent: int) -> Dict[str, Any]:
        """Sets display brightness percent (5-100) via WMI."""
        if sys.platform != "win32":
            raise RuntimeError("Brightness control is only supported on Windows.")
        target = max(5, min(100, int(percent)))
        try:
            import win32com.client
            wmi = win32com.client.GetObject("winmgmts:\\\\.\\root\\wmi")
            methods = wmi.InstancesOf("WmiMonitorBrightnessMethods")
            count = 0
            for m in methods:
                m.WmiSetBrightness(1, target)
                count += 1
            if count == 0:
                raise RuntimeError("No controllable display found. External desktop monitors do not support WMI brightness.")
            return {"status": "completed", "brightness": target, "message": f"Brightness set to {target}%."}
        except Exception as e:
            raise RuntimeError(f"Could not change brightness: {e}")

    def get_display_info(self) -> Dict[str, Any]:
        """Gets connected display resolution and count."""
        monitors = []
        if sys.platform == "win32" and win32api:
            try:
                for idx, hmon in enumerate(win32api.EnumDisplayMonitors()):
                    info = win32api.GetMonitorInfo(hmon[0])
                    rect = info.get("Monitor", (0, 0, 1920, 1080))
                    w = rect[2] - rect[0]
                    h = rect[3] - rect[1]
                    monitors.append({
                        "id": idx + 1,
                        "width": w,
                        "height": h,
                        "is_primary": bool(info.get("Flags", 0) & 1)
                    })
            except Exception:
                pass
        return {
            "count": len(monitors) or 1,
            "monitors": monitors,
            "primary": next((m for m in monitors if m.get("is_primary")), monitors[0] if monitors else {"width": 1920, "height": 1080})
        }


# ==============================================================================
# 5. APPLICATION CONTROL ADAPTER
# ==============================================================================
class ApplicationControlAdapter:
    def __init__(self, desktop_actions=None):
        self.desktop_actions = desktop_actions

    def list_running_applications(self) -> List[Dict[str, Any]]:
        """Lists running desktop applications with visible windows."""
        if sys.platform != "win32" or not win32gui:
            return []
        try:
            if self.desktop_actions and hasattr(self.desktop_actions, "list_open_windows"):
                return self.desktop_actions.list_open_windows()
        except Exception:
            pass

        # Fallback enumeration
        apps = []
        user32 = ctypes.windll.user32
        fg_hwnd = user32.GetForegroundWindow()

        def _enum(hwnd, _):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value.strip()

            ignored = ("Default IME", "MSCTFIME", "Program Manager", "Settings", "CrossDevice")
            if any(title.startswith(ig) for ig in ignored):
                return True

            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            pname = "unknown"
            mem_mb = 0.0
            try:
                p = psutil.Process(pid)
                pname = p.name()
                mem_mb = round(p.memory_info().rss / (1024 * 1024), 1)
            except Exception:
                pass

            apps.append({
                "hwnd": int(hwnd),
                "title": title,
                "process": pname,
                "app_name": pname.removesuffix(".exe").capitalize(),
                "pid": pid,
                "memory_mb": mem_mb,
                "is_active": (hwnd == fg_hwnd),
                "is_minimized": bool(user32.IsIconic(hwnd)),
                "is_maximized": bool(user32.IsZoomed(hwnd))
            })
            return True

        user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)(_enum), 0)
        apps.sort(key=lambda a: (not a["is_active"], -a["memory_mb"]))
        return apps

    def set_window_state(self, hwnd: int, state: str) -> Dict[str, Any]:
        """Sets window state: focus, minimize, maximize, restore, close."""
        if sys.platform != "win32":
            raise RuntimeError("Window control only supported on Windows.")
        if self.desktop_actions:
            if state == "focus":
                return self.desktop_actions.focus_window(hwnd)
            return self.desktop_actions.set_window_state(hwnd, state)

        user32 = ctypes.windll.user32
        if not user32.IsWindow(hwnd):
            raise RuntimeError("Window is no longer valid.")

        st = state.lower()
        if st == "focus":
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
        elif st == "minimize":
            user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
        elif st == "maximize":
            user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
        elif st == "restore":
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        elif st == "close":
            user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
        else:
            raise ValueError(f"Unknown window state: {state}")
        return {"status": "completed", "hwnd": hwnd, "state": st}

    def terminate_process(self, pid: int, force: bool = True) -> Dict[str, Any]:
        """Safely terminates an application process by PID, protecting system processes."""
        if sys.platform != "win32" or not psutil:
            raise RuntimeError("Process termination requires Windows and psutil.")
        try:
            proc = psutil.Process(pid)
            name = proc.name().lower()
            if name in PROTECTED_PROCESSES:
                raise RuntimeError(f"Cannot terminate protected system process '{name}'.")
            if force:
                proc.kill()
            else:
                proc.terminate()
            return {"status": "completed", "pid": pid, "name": name, "message": f"Terminated {name} (PID {pid})."}
        except psutil.NoSuchProcess:
            return {"status": "completed", "pid": pid, "message": "Process already terminated."}
        except Exception as e:
            raise RuntimeError(f"Failed to terminate process: {e}")

    def list_approved_apps(self) -> List[Dict[str, Any]]:
        """Lists approved launchable applications."""
        standard_apps = [
            {"id": "vscode", "name": "Visual Studio Code", "icon": "code"},
            {"id": "chrome", "name": "Google Chrome", "icon": "globe"},
            {"id": "edge", "name": "Microsoft Edge", "icon": "globe"},
            {"id": "calc", "name": "Calculator", "icon": "calculator"},
            {"id": "notepad", "name": "Notepad", "icon": "file-text"},
            {"id": "explorer", "name": "File Explorer", "icon": "folder"},
            {"id": "cmd", "name": "Terminal", "icon": "terminal"},
            {"id": "spotify", "name": "Spotify", "icon": "music"}
        ]
        if self.desktop_actions and hasattr(self.desktop_actions, "list_apps"):
            discovered = self.desktop_actions.list_apps()
            for d in discovered:
                if not any(s["id"] == d["id"] for s in standard_apps):
                    standard_apps.append({"id": d["id"], "name": d["name"], "icon": "app"})
        return standard_apps

    def launch_approved_app(self, app_id: str) -> Dict[str, Any]:
        """Launches an approved application."""
        if not self.desktop_actions:
            raise RuntimeError("Desktop launcher is unavailable.")
        try:
            prop = self.desktop_actions.propose(app_id)
            res = self.desktop_actions.confirm(prop["id"])
            return {"status": "completed", "app_id": app_id, "message": res.get("message", "App launched.")}
        except Exception as e:
            raise RuntimeError(f"Could not launch app '{app_id}': {e}")


# ==============================================================================
# 6. INPUT CONTROL ADAPTER (Trackpad, Keyboard, Presentation, Clipboard)
# ==============================================================================
class InputControlAdapter:
    def mouse_move(self, dx: int, dy: int, sensitivity: float = 1.0) -> Dict[str, Any]:
        """Moves mouse pointer relatively."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        scaled_x = int(dx * sensitivity)
        scaled_y = int(dy * sensitivity)
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_MOVE, scaled_x, scaled_y, 0, 0)
        return {"status": "completed"}

    def mouse_click(self, button: str = "left", double: bool = False) -> Dict[str, Any]:
        """Performs mouse click (left, right, middle, or double)."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        user32 = ctypes.windll.user32
        b = button.lower()
        if b == "left":
            down, up = MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
        elif b == "right":
            down, up = MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP
        elif b == "middle":
            down, up = MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP
        else:
            raise ValueError(f"Unknown button: {button}")

        user32.mouse_event(down, 0, 0, 0, 0)
        user32.mouse_event(up, 0, 0, 0, 0)
        if double:
            time.sleep(0.05)
            user32.mouse_event(down, 0, 0, 0, 0)
            user32.mouse_event(up, 0, 0, 0, 0)
        return {"status": "completed", "button": button, "double": double}

    def mouse_down(self, button: str = "left") -> Dict[str, Any]:
        """Presses and holds mouse button (for drag)."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        user32 = ctypes.windll.user32
        flag = MOUSEEVENTF_LEFTDOWN if button.lower() == "left" else MOUSEEVENTF_RIGHTDOWN
        user32.mouse_event(flag, 0, 0, 0, 0)
        return {"status": "completed"}

    def mouse_up(self, button: str = "left") -> Dict[str, Any]:
        """Releases mouse button (completes drag)."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        user32 = ctypes.windll.user32
        flag = MOUSEEVENTF_LEFTUP if button.lower() == "left" else MOUSEEVENTF_RIGHTUP
        user32.mouse_event(flag, 0, 0, 0, 0)
        return {"status": "completed"}

    def mouse_scroll(self, dy: int) -> Dict[str, Any]:
        """Scrolls mouse wheel."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        # WHEEL_DELTA is 120
        delta = int(dy * 120)
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        return {"status": "completed"}

    def keyboard_type(self, text: str) -> Dict[str, Any]:
        """Types unicode text string."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        user32 = ctypes.windll.user32
        for char in text:
            val = ord(char)
            user32.keybd_event(0, val, KEYEVENTF_UNICODE, 0)
            user32.keybd_event(0, val, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)
        return {"status": "completed", "length": len(text)}

    def keyboard_key(self, key: str) -> Dict[str, Any]:
        """Presses special key: enter, backspace, escape, tab, arrows, etc."""
        if sys.platform != "win32":
            raise RuntimeError("Input control requires Windows.")
        vk_map = {
            "enter": 0x0D, "return": 0x0D,
            "backspace": 0x08,
            "escape": 0x1B, "esc": 0x1B,
            "tab": 0x09,
            "space": 0x20,
            "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
            "pageup": 0x21, "pagedown": 0x22, "home": 0x24, "end": 0x23,
            "f5": 0x74, "f11": 0x7A,
            "win_d": "win_d", "show_desktop": "win_d"
        }
        target = key.lower()
        if target not in vk_map:
            raise ValueError(f"Unsupported special key: {key}")

        user32 = ctypes.windll.user32
        if target in ("win_d", "show_desktop"):
            user32.keybd_event(0x5B, 0, 0, 0)  # Win
            user32.keybd_event(0x44, 0, 0, 0)  # D
            user32.keybd_event(0x44, 0, KEYEVENTF_KEYUP, 0)
            user32.keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0)
        else:
            vk = vk_map[target]
            user32.keybd_event(vk, 0, 0, 0)
            user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        return {"status": "completed", "key": key}

    def presentation_control(self, command: str) -> Dict[str, Any]:
        """Lightweight presentation remote: next, prev, start, end."""
        cmd = command.lower()
        if cmd in ("next", "forward"):
            return self.keyboard_key("right")
        elif cmd in ("prev", "previous", "back"):
            return self.keyboard_key("left")
        elif cmd == "start":
            return self.keyboard_key("f5")
        elif cmd == "end":
            return self.keyboard_key("escape")
        else:
            raise ValueError(f"Unknown presentation command: {command}")

    def clipboard_get(self) -> str:
        """Reads text from PC clipboard."""
        if pyperclip:
            try:
                return (pyperclip.paste() or "").strip()
            except Exception:
                pass
        return ""

    def clipboard_set(self, text: str) -> Dict[str, Any]:
        """Sets PC clipboard text."""
        if not pyperclip:
            raise RuntimeError("Clipboard unavailable.")
        pyperclip.copy(text)
        return {"status": "completed", "length": len(text)}

    def clipboard_clear(self) -> Dict[str, Any]:
        """Clears PC clipboard."""
        if pyperclip:
            pyperclip.copy("")
        return {"status": "completed"}


# ==============================================================================
# 7. SCREEN PREVIEW ADAPTER
# ==============================================================================
class ScreenPreviewAdapter:
    def __init__(self):
        self._active_sessions = set()
        self._lock = threading.Lock()

    def start_session(self, device_id: str) -> Dict[str, Any]:
        with self._lock:
            self._active_sessions.add(device_id)
            return {"active": True, "message": "Screen preview session active."}

    def stop_session(self, device_id: str) -> Dict[str, Any]:
        with self._lock:
            self._active_sessions.discard(device_id)
            return {"active": False, "message": "Screen preview session stopped."}

    def is_active(self, device_id: str) -> bool:
        with self._lock:
            return device_id in self._active_sessions

    def capture_frame(self, quality: int = 50, max_width: int = 640) -> Optional[bytes]:
        """Captures a JPEG compressed frame of the primary desktop monitor."""
        if sys.platform != "win32" or not Image:
            return None
        try:
            # Using win32gui / win32ui / win32con for fast GDI desktop capture
            import win32gui, win32ui, win32con
            hwnd = win32gui.GetDesktopWindow()
            width = win32api.GetSystemMetrics(win32con.SM_CXSCREEN)
            height = win32api.GetSystemMetrics(win32con.SM_CYSCREEN)

            hwndDC = win32gui.GetWindowDC(hwnd)
            mfcDC = win32ui.CreateDCFromHandle(hwndDC)
            saveDC = mfcDC.CreateCompatibleDC()

            saveBitMap = win32ui.CreateBitmap()
            saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
            saveDC.SelectObject(saveBitMap)

            # BitBlt from screen to memory DC
            saveDC.BitBlt((0, 0), (width, height), mfcDC, (0, 0), win32con.SRCCOPY)

            bmpinfo = saveBitMap.GetInfo()
            bmpstr = saveBitMap.GetBitmapBits(True)

            img = Image.frombuffer('RGB', (bmpinfo['bmWidth'], bmpinfo['bmHeight']), bmpstr, 'raw', 'BGRX', 0, 1)

            # Cleanup GDI handles
            win32gui.DeleteObject(saveBitMap.GetHandle())
            saveDC.DeleteDC()
            mfcDC.DeleteDC()
            win32gui.ReleaseDC(hwnd, hwndDC)

            # Resize if needed
            if width > max_width:
                aspect = height / width
                target_height = int(max_width * aspect)
                img = img.resize((max_width, target_height), Image.Resampling.BILINEAR)

            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            return buf.getvalue()
        except Exception as e:
            logger.debug("Desktop frame capture failed: %s", e)
            return None


# ==============================================================================
# 8. WAKE-ON-LAN ADAPTER
# ==============================================================================
class WakeOnLanAdapter:
    @staticmethod
    def get_mac_addresses() -> List[Dict[str, str]]:
        """Detects MAC addresses of active network adapters."""
        adapters = []
        if psutil:
            try:
                for name, addrs in psutil.net_if_addrs().items():
                    mac = None
                    ip = None
                    for addr in addrs:
                        if addr.family == psutil.AF_LINK:
                            mac = addr.address
                        elif addr.family == socket.AF_INET and not addr.address.startswith("127."):
                            ip = addr.address
                    if mac and mac.replace("-", ":").count(":") == 5:
                        adapters.append({"name": name, "mac": mac.replace("-", ":").upper(), "ip": ip or ""})
            except Exception:
                pass
        return adapters

    @staticmethod
    def send_magic_packet(mac_address: str, broadcast_ip: str = "255.255.255.255", port: int = 9) -> Dict[str, Any]:
        """Sends standard Wake-on-LAN magic packet."""
        clean_mac = re.sub(r"[^a-fA-F0-9]", "", mac_address)
        if len(clean_mac) != 12:
            raise ValueError(f"Invalid MAC address: {mac_address}")

        mac_bytes = bytes.fromhex(clean_mac)
        magic_packet = b"\xff" * 6 + mac_bytes * 16

        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.sendto(magic_packet, (broadcast_ip, port))

        return {"status": "completed", "mac": mac_address, "message": f"Wake-on-LAN magic packet broadcasted for {mac_address}."}


# ==============================================================================
# 9. ORACLE SYSTEM LIFECYCLE ADAPTER
# ==============================================================================
class OracleSystemControlAdapter:
    def __init__(self, oracle_root: Optional[Path] = None):
        self.oracle_root = oracle_root or Path(__file__).resolve().parents[2]

    def get_status(self) -> Dict[str, Any]:
        """Checks whether Oracle backend, frontend, ollama, and database are responding."""
        # 1. Backend check (port 8000)
        backend_ok = False
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.6)
                backend_ok = (s.connect_ex(("127.0.0.1", 8000)) == 0)
        except Exception:
            backend_ok = False

        # 2. Frontend check (ports 5173, 3000)
        frontend_ok = False
        frontend_port = None
        for port in (5173, 3000):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.4)
                    if s.connect_ex(("127.0.0.1", port)) == 0:
                        frontend_ok = True
                        frontend_port = port
                        break
            except Exception:
                pass

        # 3. Ollama check (ports 11420, 11434)
        ollama_ok = False
        ollama_port = None
        for port in (11420, 11434):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.4)
                    if s.connect_ex(("127.0.0.1", port)) == 0:
                        ollama_ok = True
                        ollama_port = port
                        break
            except Exception:
                pass

        # 4. PostgreSQL cluster check (port 55432)
        db_ok = False
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.4)
                db_ok = (s.connect_ex(("127.0.0.1", 55432)) == 0)
        except Exception:
            db_ok = False

        running = backend_ok
        return {
            "running": running,
            "backend": backend_ok,
            "frontend": frontend_ok,
            "frontendPort": frontend_port,
            "ollama": ollama_ok,
            "ollamaPort": ollama_port,
            "database": db_ok,
            "status": "running" if running else "stopped",
            "message": "Oracle Central is active." if running else "Oracle Central is stopped."
        }

    def start_system(self) -> Dict[str, Any]:
        """Starts Oracle system via run-system.ps1 in a detached background process."""
        curr = self.get_status()
        if curr["running"]:
            return {
                "status": "completed",
                "running": True,
                "alreadyRunning": True,
                "message": "Oracle AI system is already running."
            }

        run_script = self.oracle_root / "scripts" / "run-system.ps1"
        if not run_script.exists():
            raise FileNotFoundError(f"Missing Oracle start script at {run_script}")

        creationflags = 0
        if sys.platform == "win32":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)

        cmd = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", str(run_script)
        ]
        subprocess.Popen(
            cmd,
            cwd=str(self.oracle_root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags
        )
        return {
            "status": "accepted",
            "running": True,
            "message": "Oracle system startup initiated in background. Subsystems will come online shortly."
        }

    def stop_system(self) -> Dict[str, Any]:
        """Stops Oracle backend, frontend, and database services while leaving Gateway running."""
        stopped = []
        my_pid = os.getpid()

        # 1. Terminate backend (8000) and frontend (5173, 3000)
        if psutil:
            for proc in psutil.process_iter(['pid', 'name']):
                if proc.pid == my_pid:
                    continue
                try:
                    for conn in proc.connections(kind='inet'):
                        if conn.laddr.ip in ('127.0.0.1', '0.0.0.0') and conn.laddr.port in (8000, 5173, 3000):
                            name = proc.info.get('name', 'process')
                            proc.terminate()
                            stopped.append(f"{name} (PID {proc.pid}, port {conn.laddr.port})")
                            break
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
        elif sys.platform == "win32":
            for port in (8000, 5173, 3000):
                try:
                    out = subprocess.check_output(f'netstat -ano | findstr :{port}', shell=True, text=True)
                    for line in out.splitlines():
                        parts = line.strip().split()
                        if len(parts) >= 5 and "LISTENING" in parts:
                            pid = int(parts[-1])
                            if pid != my_pid and pid > 0:
                                subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
                                stopped.append(f"Port {port} (PID {pid})")
                except Exception:
                    pass

        # 2. Stop dedicated PostgreSQL cluster
        pg_stop_script = self.oracle_root / "scripts" / "manage_postgres.py"
        python_exe = self.oracle_root / "backend" / ".venv" / "Scripts" / "python.exe"
        if not python_exe.exists():
            python_exe = Path(sys.executable)

        if pg_stop_script.exists():
            try:
                subprocess.run(
                    [str(python_exe), str(pg_stop_script), "--stop"],
                    cwd=str(self.oracle_root),
                    timeout=10,
                    capture_output=True
                )
                stopped.append("PostgreSQL cluster (55432)")
            except Exception as e:
                logger.debug("Failed stopping postgres: %s", e)

        return {
            "status": "completed",
            "running": False,
            "stopped": stopped,
            "message": f"Oracle system stopped ({len(stopped)} services terminated). Gateway remains online."
        }

    def restart_system(self) -> Dict[str, Any]:
        """Restarts Oracle system."""
        self.stop_system()
        time.sleep(1.5)
        return self.start_system()

