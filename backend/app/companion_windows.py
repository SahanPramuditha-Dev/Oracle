"""Windows system control adapters for Oracle Companion."""
import asyncio
import ctypes
import ctypes.wintypes as w
import io
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Virtual key codes
VK_MAP = {
    "play_pause": 0xB3,
    "next": 0xB0,
    "prev": 0xB1,
    "previous": 0xB1,
    "stop": 0xB2,
    "volume_up": 0xAF,
    "volume_down": 0xAE,
    "mute": 0xAD,
    "f5": 0x74,
    "escape": 0x1B,
    "esc": 0x1B,
    "enter": 0x0D,
    "return": 0x0D,
    "backspace": 0x08,
    "tab": 0x09,
    "space": 0x20,
    "left": 0x25,
    "up": 0x26,
    "right": 0x27,
    "down": 0x28,
    "page_up": 0x21,
    "pageup": 0x21,
    "page_down": 0x22,
    "pagedown": 0x22,
    "home": 0x24,
    "end": 0x23,
    "win_d": 0x44, # with Win key
}

# Protected processes that must never be terminated
PROTECTED_PROCESS_NAMES = {
    "oracle", "python", "pythonw", "system", "smss.exe", "csrss.exe", "wininit.exe",
    "services.exe", "lsass.exe", "winlogon.exe", "explorer.exe", "dwm.exe",
    "svchost.exe", "spoolsv.exe", "taskhostw.exe", "sihost.exe", "fontdrvhost.exe"
}

# --- Stay Awake State ---
_stay_awake_timer = None
_stay_awake_lock = threading.Lock()
_stay_awake_expires_at = 0

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002


def _set_execution_state(flags):
    if os.name == "nt":
        try:
            return ctypes.windll.kernel32.SetThreadExecutionState(flags)
        except Exception:
            return 0
    return 0


def stay_awake(duration_minutes=None, cancel=False):
    """Prevent PC from sleeping for a given duration, or cancel existing stay-awake."""
    global _stay_awake_timer, _stay_awake_expires_at
    with _stay_awake_lock:
        if cancel or duration_minutes is None or duration_minutes <= 0:
            if _stay_awake_timer:
                _stay_awake_timer.cancel()
                _stay_awake_timer = None
            _stay_awake_expires_at = 0
            _set_execution_state(ES_CONTINUOUS)
            return {"active": False, "remaining_seconds": 0, "message": "Stay-awake disabled."}

        # Enable stay awake
        _set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
        seconds = int(duration_minutes * 60)
        _stay_awake_expires_at = int(time.time()) + seconds

        if _stay_awake_timer:
            _stay_awake_timer.cancel()

        def _expire():
            with _stay_awake_lock:
                _set_execution_state(ES_CONTINUOUS)
                global _stay_awake_expires_at
                _stay_awake_expires_at = 0

        _stay_awake_timer = threading.Timer(seconds, _expire)
        _stay_awake_timer.daemon = True
        _stay_awake_timer.start()

        return {
            "active": True,
            "duration_minutes": duration_minutes,
            "remaining_seconds": seconds,
            "expires_at": _stay_awake_expires_at,
            "message": f"PC will stay awake for {duration_minutes} minutes."
        }


def get_stay_awake_status():
    with _stay_awake_lock:
        now = int(time.time())
        active = _stay_awake_expires_at > now
        remaining = max(0, _stay_awake_expires_at - now) if active else 0
        return {"active": active, "remaining_seconds": remaining, "expires_at": _stay_awake_expires_at}


# --- Power and Session ---

def lock_workstation():
    if os.name != "nt":
        raise RuntimeError("Windows required to lock workstation.")
    try:
        accepted = ctypes.windll.user32.LockWorkStation()
        if not accepted:
            raise RuntimeError("Windows rejected the lock workstation request.")
        return {"status": "ok", "message": "Windows workstation locked."}
    except Exception as e:
        raise RuntimeError(f"Lock workstation failed: {e}")


def sleep_pc():
    if os.name != "nt":
        raise RuntimeError("Windows required for sleep.")
    try:
        is_allowed = bool(ctypes.windll.powrprof.IsPwrSuspendAllowed())
        if not is_allowed:
            raise RuntimeError("Windows does not support sleep in its current power state.")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        token = w.HANDLE()
        kernel.GetCurrentProcess.restype = w.HANDLE
        if not advapi.OpenProcessToken(w.HANDLE(kernel.GetCurrentProcess()), 0x28, ctypes.byref(token)):
            raise ctypes.WinError(ctypes.get_last_error())

        class Privilege(ctypes.Structure):
            _fields_ = [("count", w.DWORD), ("low", w.DWORD), ("high", w.LONG), ("attributes", w.DWORD)]

        priv = Privilege(1, 0, 0, 2)
        prev = Privilege()
        size = w.DWORD()
        try:
            if not advapi.LookupPrivilegeValueW(None, ctypes.c_wchar_p("SeShutdownPrivilege"), ctypes.byref(priv, 4)):
                raise ctypes.WinError(ctypes.get_last_error())
            ctypes.set_last_error(0)
            if not advapi.AdjustTokenPrivileges(token, 0, ctypes.byref(priv), ctypes.sizeof(prev), ctypes.byref(prev), ctypes.byref(size)):
                raise ctypes.WinError(ctypes.get_last_error())
            suspend = ctypes.windll.powrprof.SetSuspendState
            suspend.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ubyte]
            suspend.restype = ctypes.c_ubyte
            if not suspend(0, 0, 0):
                raise RuntimeError("Windows sleep call returned failure.")
        finally:
            advapi.AdjustTokenPrivileges(token, 0, ctypes.byref(prev), 0, None, None)
            kernel.CloseHandle(token)
        return {"status": "ok", "message": "Sleep command initiated."}
    except Exception as e:
        raise RuntimeError(f"Sleep failed: {e}")


def hibernate_pc():
    if os.name != "nt":
        raise RuntimeError("Windows required for hibernate.")
    try:
        is_allowed = bool(ctypes.windll.powrprof.IsPwrHibernateAllowed())
        if not is_allowed:
            raise RuntimeError("Hibernation is not enabled or supported on this system.")
        suspend = ctypes.windll.powrprof.SetSuspendState
        suspend.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ubyte]
        suspend.restype = ctypes.c_ubyte
        if not suspend(1, 0, 0):
            raise RuntimeError("Windows hibernate call returned failure.")
        return {"status": "ok", "message": "Hibernation initiated."}
    except Exception as e:
        raise RuntimeError(f"Hibernate failed: {e}")


def shutdown_pc(restart=False):
    if os.name != "nt":
        raise RuntimeError("Windows required for shutdown.")
    binary = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "shutdown.exe")
    flag = "/r" if restart else "/s"
    try:
        result = subprocess.run([binary, flag, "/t", "0"], capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode != 0:
            err = result.stderr.decode(errors="replace").strip()
            raise RuntimeError(f"Windows rejected shutdown: {err}")
        return {"status": "ok", "message": f"{'Restart' if restart else 'Shutdown'} command initiated."}
    except Exception as e:
        raise RuntimeError(f"Power command failed: {e}")


def sign_out():
    if os.name != "nt":
        raise RuntimeError("Windows required for sign out.")
    try:
        EWX_LOGOFF = 0x00000000
        user32 = ctypes.windll.user32
        res = user32.ExitWindowsEx(EWX_LOGOFF, 0)
        if not res:
            raise RuntimeError("ExitWindowsEx rejected sign out.")
        return {"status": "ok", "message": "User sign out initiated."}
    except Exception as e:
        raise RuntimeError(f"Sign out failed: {e}")


def turn_off_display():
    if os.name != "nt":
        raise RuntimeError("Windows required to turn off display.")
    try:
        # HWND_BROADCAST = 0xFFFF, WM_SYSCOMMAND = 0x0112, SC_MONITORPOWER = 0xF170, 2 = Power off
        ctypes.windll.user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
        return {"status": "ok", "message": "Display low-power sleep command sent."}
    except Exception as e:
        raise RuntimeError(f"Turn off display failed: {e}")


def get_power_status():
    uptime_sec = 0
    battery_info = None
    try:
        import psutil
        uptime_sec = int(time.time() - psutil.boot_time())
        batt = psutil.sensors_battery()
        if batt:
            battery_info = {
                "percent": round(batt.percent),
                "pluggedIn": bool(batt.power_plugged),
                "charging": bool(batt.power_plugged and batt.percent < 100),
                "secondsLeft": batt.secsleft if batt.secsleft != psutil.POWER_TIME_UNLIMITED else None
            }
    except Exception:
        pass

    can_sleep = False
    can_hibernate = False
    if os.name == "nt":
        try:
            can_sleep = bool(ctypes.windll.powrprof.IsPwrSuspendAllowed())
            can_hibernate = bool(ctypes.windll.powrprof.IsPwrHibernateAllowed())
        except Exception:
            pass

    return {
        "uptime_seconds": uptime_sec,
        "battery": battery_info,
        "can_sleep": can_sleep,
        "can_hibernate": can_hibernate,
        "stay_awake": get_stay_awake_status()
    }


# --- Audio Control ---

def get_master_volume():
    try:
        from pycaw.pycaw import AudioUtilities
        speakers = AudioUtilities.GetSpeakers()
        vol = round(float(speakers.volume_percent))
        muted = bool(speakers.EndpointVolume.GetMute())
        return {"percent": vol, "muted": muted}
    except Exception as e:
        logger.warning(f"Failed to get master volume: {e}")
        return {"percent": 50, "muted": False}


def set_master_volume(level):
    try:
        from pycaw.pycaw import AudioUtilities
        target = max(0, min(100, int(level)))
        speakers = AudioUtilities.GetSpeakers()
        speakers.volume_percent = float(target)
        if speakers.EndpointVolume.GetMute():
            speakers.EndpointVolume.SetMute(0, None)
        return {"status": "ok", "percent": target, "muted": False}
    except Exception as e:
        raise RuntimeError(f"Could not set master volume: {e}")


def set_master_mute(muted: bool):
    try:
        from pycaw.pycaw import AudioUtilities
        speakers = AudioUtilities.GetSpeakers()
        speakers.EndpointVolume.SetMute(1 if muted else 0, None)
        vol = round(float(speakers.volume_percent))
        return {"status": "ok", "muted": bool(muted), "percent": vol}
    except Exception as e:
        raise RuntimeError(f"Could not set mute: {e}")


def get_microphone_status():
    try:
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        from pycaw.constants import EDataFlow, ERole
        from comtypes import CLSCTX_ALL
        from ctypes import cast, POINTER

        device_enumerator = AudioUtilities.GetDeviceEnumerator()
        mic_dev = device_enumerator.GetDefaultAudioEndpoint(EDataFlow.eCapture.value, ERole.eMultimedia.value)
        endpoint = mic_dev.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        vol_ctl = cast(endpoint, POINTER(IAudioEndpointVolume))
        muted = bool(vol_ctl.GetMute())
        vol = round(vol_ctl.GetMasterVolumeLevelScalar() * 100)
        return {"available": True, "muted": muted, "percent": vol}
    except Exception as e:
        return {"available": False, "muted": False, "percent": 0, "reason": str(e)}


def set_microphone_mute(muted: bool):
    try:
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        from pycaw.constants import EDataFlow, ERole
        from comtypes import CLSCTX_ALL
        from ctypes import cast, POINTER

        device_enumerator = AudioUtilities.GetDeviceEnumerator()
        mic_dev = device_enumerator.GetDefaultAudioEndpoint(EDataFlow.eCapture.value, ERole.eMultimedia.value)
        endpoint = mic_dev.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        vol_ctl = cast(endpoint, POINTER(IAudioEndpointVolume))
        vol_ctl.SetMute(1 if muted else 0, None)
        return {"status": "ok", "muted": bool(muted)}
    except Exception as e:
        raise RuntimeError(f"Could not set microphone mute: {e}")


def list_audio_devices():
    devices = []
    try:
        from pycaw.pycaw import AudioUtilities, AudioDeviceState
        for d in AudioUtilities.GetAllDevices():
            name = getattr(d, "FriendlyName", "Audio Device")
            state_val = getattr(d, "state", None)
            is_active = (state_val == AudioDeviceState.Active)
            devices.append({
                "id": str(getattr(d, "id", "")),
                "name": str(name),
                "active": is_active,
                "state": str(state_val)
            })
    except Exception as e:
        logger.warning(f"Failed to list audio devices: {e}")
    return devices


def list_audio_sessions():
    sessions_list = []
    try:
        from pycaw.pycaw import AudioUtilities
        sessions = AudioUtilities.GetAllSessions()
        seen_pids = set()
        for s in sessions:
            if s.Process and s.Process.pid not in seen_pids:
                seen_pids.add(s.Process.pid)
                pname = s.Process.name()
                vol = round(s.SimpleAudioVolume.GetMasterVolume() * 100)
                muted = bool(s.SimpleAudioVolume.GetMute())
                sessions_list.append({
                    "pid": s.Process.pid,
                    "name": pname.removesuffix(".exe"),
                    "process": pname,
                    "percent": vol,
                    "muted": muted
                })
    except Exception as e:
        logger.warning(f"Failed to list audio sessions: {e}")
    return sessions_list


def set_app_volume(pid: int, percent: int, mute: bool = None):
    try:
        from pycaw.pycaw import AudioUtilities
        target = max(0, min(100, int(percent)))
        sessions = AudioUtilities.GetAllSessions()
        found = False
        for s in sessions:
            if s.Process and s.Process.pid == pid:
                s.SimpleAudioVolume.SetMasterVolume(float(target) / 100.0, None)
                if mute is not None:
                    s.SimpleAudioVolume.SetMute(1 if mute else 0, None)
                found = True
        if not found:
            raise RuntimeError(f"Audio session for PID {pid} not found.")
        return {"status": "ok", "pid": pid, "percent": target, "muted": bool(mute) if mute is not None else False}
    except Exception as e:
        raise RuntimeError(f"Could not set app volume: {e}")


# --- Media Control ---

def _run_winrt(coro_fn):
    import concurrent.futures
    import faulthandler
    def worker():
        was_enabled = faulthandler.is_enabled()
        if was_enabled:
            faulthandler.disable()
        try:
            import pythoncom
            pythoncom.CoInitializeEx(pythoncom.COINIT_MULTITHREADED)
        except Exception:
            pass
        try:
            return asyncio.run(coro_fn())
        finally:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except Exception:
                pass
            if was_enabled:
                faulthandler.enable()

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(worker).result(timeout=2.0)


def get_media_status():
    result = {"title": "", "artist": "", "album": "", "status": "Stopped", "app": ""}
    try:
        from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as SM

        async def _fetch():
            mgr = await SM.request_async()
            cur = mgr.get_current_session()
            if cur:
                props = await cur.try_get_media_properties_async()
                info = cur.get_playback_info()
                stat_str = "Stopped"
                if info:
                    stat_code = getattr(info.playback_status, "value", info.playback_status)
                    stat_map = {3: "Playing", 4: "Paused", 5: "Stopped", 2: "Changing", 1: "Closed", 0: "Unknown"}
                    stat_str = stat_map.get(stat_code, str(info.playback_status))
                return {
                    "title": getattr(props, "title", ""),
                    "artist": getattr(props, "artist", ""),
                    "album": getattr(props, "album_title", ""),
                    "status": stat_str,
                    "app": getattr(cur, "source_app_user_model_id", "")
                }
            return result

        fetched = _run_winrt(_fetch)
        if fetched:
            return fetched
    except Exception as e:
        logger.debug(f"GSMTC session fetch failed: {e}")
    return result


def send_media_action(action: str):
    action_l = action.lower()
    # First try winsdk async
    try:
        from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as SM

        async def _exec():
            mgr = await SM.request_async()
            cur = mgr.get_current_session()
            if cur:
                if action_l in ("play_pause", "toggle"):
                    return await cur.try_toggle_play_pause_async()
                elif action_l == "play":
                    return await cur.try_play_async()
                elif action_l == "pause":
                    return await cur.try_pause_async()
                elif action_l in ("next", "skip_next"):
                    return await cur.try_skip_next_async()
                elif action_l in ("prev", "previous", "skip_prev"):
                    return await cur.try_skip_previous_async()
                elif action_l == "stop":
                    return await cur.try_stop_async()
            return False

        done = _run_winrt(_exec)
        if done:
            return {"status": "ok", "action": action_l, "method": "GSMTC"}
    except Exception:
        pass

    # Fallback to keybd_event
    vk = VK_MAP.get(action_l)
    if not vk:
        raise RuntimeError(f"Unknown media action: {action}")
    try:
        user32 = ctypes.windll.user32
        user32.keybd_event(vk, 0, 0, 0)
        user32.keybd_event(vk, 0, 2, 0)
        return {"status": "ok", "action": action_l, "method": "keybd_event"}
    except Exception as e:
        raise RuntimeError(f"Media key dispatch failed: {e}")


# --- Display Control ---

_cached_brightness = None
_cached_brightness_time = 0.0
_brightness_lock = threading.Lock()


def get_brightness():
    global _cached_brightness, _cached_brightness_time
    if os.name != "nt":
        return None
    now = time.monotonic()
    with _brightness_lock:
        if _cached_brightness is not None and (now - _cached_brightness_time) < 4.0:
            return _cached_brightness

    # 1. In-process COM query (fast: ~30-50ms)
    try:
        import win32com.client
        wmi = win32com.client.GetObject('winmgmts:\\\\.\\root\\wmi')
        items = wmi.ExecQuery('SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active = True')
        for item in items:
            val = int(item.CurrentBrightness)
            with _brightness_lock:
                _cached_brightness = val
                _cached_brightness_time = now
            return val
    except Exception:
        pass

    # 2. Fallback to PowerShell CIM
    executable = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32",
                              "WindowsPowerShell", "v1.0", "powershell.exe")
    script = (
        "$display = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | "
        "Where-Object Active | Select-Object -First 1; "
        "if ($display) { [Console]::WriteLine($display.CurrentBrightness) }"
    )
    try:
        result = subprocess.run([executable, "-NoProfile", "-NonInteractive", "-Command", script],
                                capture_output=True, text=True, timeout=3, creationflags=subprocess.CREATE_NO_WINDOW)
        val = result.stdout.strip()
        if val.isdigit() and 0 <= int(val) <= 100:
            b_val = int(val)
            with _brightness_lock:
                _cached_brightness = b_val
                _cached_brightness_time = now
            return b_val
    except Exception:
        pass
    return None


def set_brightness(level: int):
    global _cached_brightness, _cached_brightness_time
    if os.name != "nt":
        raise RuntimeError("Windows required for brightness.")
    if not 0 <= level <= 100:
        raise ValueError("Brightness must be between 0 and 100.")

    with _brightness_lock:
        _cached_brightness = level
        _cached_brightness_time = time.monotonic()

    executable = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32",
                              "WindowsPowerShell", "v1.0", "powershell.exe")
    script = (
        f"$display = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; "
        f"if (!$display) {{ exit 1 }}; "
        f"$res = Invoke-CimMethod -InputObject $display -MethodName WmiSetBrightness -Arguments @{{ Timeout=[uint32]0; Brightness=[byte]{level} }} -ErrorAction Stop; "
        f"if ($res.ReturnValue -ne 0) {{ exit 1 }}; "
        f"[Console]::WriteLine('{level}')"
    )
    try:
        result = subprocess.run([executable, "-NoProfile", "-NonInteractive", "-Command", script],
                                capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode != 0:
            raise RuntimeError("Brightness method rejected or unsupported on this display.")
        return {"status": "ok", "brightness": level}
    except Exception as e:
        raise RuntimeError(f"Brightness control failed: {e}")


def list_monitors():
    monitors = []
    try:
        import win32api, win32con
        mons = win32api.EnumDisplayMonitors()
        for i, (hmon, hdc, rect) in enumerate(mons):
            info = win32api.GetMonitorInfo(hmon)
            is_primary = bool(info.get("Flags") == win32con.MONITORINFOF_PRIMARY)
            dev_name = str(info.get("Device", f"Display{i+1}"))
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            monitors.append({
                "index": i,
                "device": dev_name,
                "primary": is_primary,
                "width": w,
                "height": h,
                "rect": {"x": rect[0], "y": rect[1], "w": w, "h": h}
            })
    except Exception as e:
        logger.warning(f"Failed to list monitors: {e}")
    return monitors


def set_display_topology(mode: str):
    """Set display mode: clone, extend, internal, external."""
    mode_l = mode.lower()
    valid_flags = {
        "clone": "/clone",
        "duplicate": "/clone",
        "extend": "/extend",
        "internal": "/internal",
        "external": "/external"
    }
    flag = valid_flags.get(mode_l)
    if not flag:
        raise ValueError(f"Invalid display topology: {mode}. Choose from clone, extend, internal, external.")
    binary = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "displayswitch.exe")
    try:
        subprocess.run([binary, flag], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        return {"status": "ok", "topology": mode_l, "message": f"Display topology switched to {mode_l}."}
    except Exception as e:
        raise RuntimeError(f"Display switch failed: {e}")


# --- Applications and Window Management ---

def list_running_applications():
    import psutil
    import win32gui
    import win32process

    apps = []
    seen_hwnds = set()
    fg_hwnd = win32gui.GetForegroundWindow()

    def enum_windows_callback(hwnd, extra):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd).strip()
        if not title:
            return True

        ignored = ("Default IME", "MSCTFIME", "GDI+", "SystemResource", "Program Manager",
                   "Windows Input Experience", "Task Host Window", "DWM Notification Window")
        if any(title.startswith(ig) for ig in ignored):
            return True

        rect = win32gui.GetWindowRect(hwnd)
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        if w < 50 or h < 50:
            return True

        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            proc = psutil.Process(pid)
            pname = proc.name()
            mem_mb = round(proc.memory_info().rss / (1024 * 1024), 1)
        except Exception:
            return True

        is_minimized = bool(win32gui.IsIconic(hwnd))
        is_maximized = bool(win32gui.IsZoomed(hwnd))
        is_active = (hwnd == fg_hwnd)

        apps.append({
            "hwnd": int(hwnd),
            "pid": pid,
            "title": title,
            "process": pname,
            "name": pname.removesuffix(".exe"),
            "memory_mb": mem_mb,
            "active": is_active,
            "minimized": is_minimized,
            "maximized": is_maximized
        })
        return True

    try:
        win32gui.EnumWindows(enum_windows_callback, None)
        apps.sort(key=lambda a: (not a["active"], -a["memory_mb"]))
    except Exception as e:
        logger.warning(f"Error enumerating windows: {e}")
    return apps


def set_window_state(hwnd: int, state: str):
    import win32gui
    import win32con
    import win32process

    if not win32gui.IsWindow(hwnd):
        raise RuntimeError("Target window is no longer available.")

    st = state.lower()
    if st == "focus":
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        else:
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)

        fg = win32gui.GetForegroundWindow()
        cur_t, _ = win32process.GetWindowThreadProcessId(fg)
        tgt_t, _ = win32process.GetWindowThreadProcessId(hwnd)
        user32 = ctypes.windll.user32
        if cur_t != tgt_t:
            user32.AttachThreadInput(cur_t, tgt_t, True)
            user32.keybd_event(0x12, 0, 0, 0)
            user32.keybd_event(0x12, 0, 2, 0)
            win32gui.SetForegroundWindow(hwnd)
            win32gui.BringWindowToTop(hwnd)
            user32.AttachThreadInput(cur_t, tgt_t, False)
        else:
            win32gui.SetForegroundWindow(hwnd)
            win32gui.BringWindowToTop(hwnd)
        return {"status": "ok", "hwnd": hwnd, "action": "focus"}

    elif st == "minimize":
        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
    elif st == "maximize":
        win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
    elif st == "restore":
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    elif st == "close":
        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
    elif st in ("tile_left", "tile_right"):
        rect = w.RECT()
        ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
        ww = rect.right - rect.left
        wh = rect.bottom - rect.top
        half_w = ww // 2
        nx = rect.left if st == "tile_left" else rect.left + half_w
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        ctypes.windll.user32.MoveWindow(hwnd, nx, rect.top, half_w, wh, True)
        set_window_state(hwnd, "focus")
    else:
        raise ValueError(f"Unsupported window state action: {state}")
    return {"status": "ok", "hwnd": hwnd, "action": st}


def terminate_application(pid: int, force: bool = False):
    import psutil
    try:
        proc = psutil.Process(pid)
        pname = proc.name().lower()
        if any(prot in pname for prot in PROTECTED_PROCESS_NAMES):
            raise RuntimeError(f"Process {proc.name()} (PID {pid}) is protected from termination.")
        if force:
            proc.kill()
        else:
            proc.terminate()
        return {"status": "ok", "pid": pid, "name": proc.name(), "action": "kill" if force else "terminate"}
    except psutil.NoSuchProcess:
        return {"status": "ok", "pid": pid, "message": "Process already terminated."}
    except Exception as e:
        raise RuntimeError(f"Could not terminate process {pid}: {e}")


# --- Remote Input (Trackpad & Keyboard) ---

def send_mouse_input(event_type: str, dx: int = 0, dy: int = 0, button: str = "left", delta: int = 0):
    user32 = ctypes.windll.user32
    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    MOUSEEVENTF_WHEEL = 0x0800

    et = event_type.lower()
    if et == "move":
        user32.mouse_event(MOUSEEVENTF_MOVE, int(dx), int(dy), 0, 0)
    elif et == "click":
        btn = button.lower()
        if btn == "left":
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        elif btn == "right":
            user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        elif btn == "middle":
            user32.mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)
            user32.mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)
    elif et == "double_click":
        user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    elif et == "scroll":
        user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(delta), 0)
    elif et == "mouse_down":
        flag = MOUSEEVENTF_LEFTDOWN if button == "left" else MOUSEEVENTF_RIGHTDOWN
        user32.mouse_event(flag, 0, 0, 0, 0)
    elif et == "mouse_up":
        flag = MOUSEEVENTF_LEFTUP if button == "left" else MOUSEEVENTF_RIGHTUP
        user32.mouse_event(flag, 0, 0, 0, 0)
    else:
        raise ValueError(f"Unknown mouse event type: {event_type}")
    return {"status": "ok"}


def send_keyboard_input(event_type: str, text: str = None, key: str = None, vk: int = None):
    user32 = ctypes.windll.user32
    et = event_type.lower()
    if et == "text" and text:
        # Type unicode characters safely via SendInput
        for char in text:
            # KEYEVENTF_UNICODE = 0x0004, KEYEVENTF_KEYUP = 0x0002
            scan = ord(char)
            user32.keybd_event(0, scan, 0x0004, 0)
            user32.keybd_event(0, scan, 0x0004 | 0x0002, 0)
        return {"status": "ok", "length": len(text)}
    elif et == "key":
        code = vk or VK_MAP.get(str(key).lower())
        if not code:
            raise ValueError(f"Unknown key: {key}")
        user32.keybd_event(code, 0, 0, 0)
        user32.keybd_event(code, 0, 2, 0)
        return {"status": "ok", "key": key}
    elif et == "shortcut":
        sc = str(key).lower()
        if sc == "ctrl_c":
            user32.keybd_event(0x11, 0, 0, 0) # Ctrl
            user32.keybd_event(0x43, 0, 0, 0) # C
            user32.keybd_event(0x43, 0, 2, 0)
            user32.keybd_event(0x11, 0, 2, 0)
        elif sc == "ctrl_v":
            user32.keybd_event(0x11, 0, 0, 0)
            user32.keybd_event(0x56, 0, 0, 0) # V
            user32.keybd_event(0x56, 0, 2, 0)
            user32.keybd_event(0x11, 0, 2, 0)
        elif sc == "alt_tab":
            user32.keybd_event(0x12, 0, 0, 0) # Alt
            user32.keybd_event(0x09, 0, 0, 0) # Tab
            user32.keybd_event(0x09, 0, 2, 0)
            user32.keybd_event(0x12, 0, 2, 0)
        elif sc in ("win_d", "show_desktop"):
            user32.keybd_event(0x5B, 0, 0, 0) # Win
            user32.keybd_event(0x44, 0, 0, 0) # D
            user32.keybd_event(0x44, 0, 2, 0)
            user32.keybd_event(0x5B, 0, 2, 0)
        elif sc in ("presentation_start", "slideshow_start"):
            user32.keybd_event(0x74, 0, 0, 0) # F5
            user32.keybd_event(0x74, 0, 2, 0)
        elif sc in ("presentation_exit", "slideshow_exit"):
            user32.keybd_event(0x1B, 0, 0, 0) # Esc
            user32.keybd_event(0x1B, 0, 2, 0)
        else:
            raise ValueError(f"Unknown shortcut: {key}")
        return {"status": "ok", "shortcut": key}
    raise ValueError(f"Invalid keyboard event type: {event_type}")


# --- Clipboard ---

def read_clipboard():
    try:
        import pyperclip
        return {"text": pyperclip.paste() or ""}
    except Exception as e:
        return {"text": "", "error": str(e)}


def write_clipboard(text: str):
    try:
        import pyperclip
        pyperclip.copy(text)
        return {"status": "ok", "length": len(text)}
    except Exception as e:
        raise RuntimeError(f"Clipboard write failed: {e}")


def clear_clipboard():
    try:
        import pyperclip
        pyperclip.copy("")
        return {"status": "ok"}
    except Exception as e:
        raise RuntimeError(f"Clipboard clear failed: {e}")


# --- Wake-on-LAN ---

def send_wol_packet(mac: str, broadcast="255.255.255.255", port=9):
    clean = mac.replace(":", "").replace("-", "").replace(".", "")
    if len(clean) != 12:
        raise ValueError(f"Invalid MAC address: {mac}")
    mac_bytes = bytes.fromhex(clean)
    packet = b"\xff" * 6 + mac_bytes * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        sock.sendto(packet, (broadcast, port))
        return {"status": "ok", "mac": mac, "broadcast": broadcast, "port": port}
    finally:
        sock.close()


def get_wake_capabilities():
    macs = []
    try:
        import psutil
        for iface, addrs in psutil.net_if_addrs().items():
            for a in addrs:
                if a.family == psutil.AF_LINK and a.address:
                    macs.append({"interface": iface, "mac": a.address})
    except Exception:
        pass
    return {
        "configured": len(macs) > 0,
        "adapters": macs
    }


# --- Remote Screen Preview ---
_screen_sharing_active = False
_screen_sharing_lock = threading.Lock()
_screen_capture_pool = None
_screen_capture_lock = threading.Lock()


def _get_capture_pool():
    global _screen_capture_pool
    with _screen_capture_lock:
        if _screen_capture_pool is None:
            import concurrent.futures
            _screen_capture_pool = concurrent.futures.ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="OracleScreenCapture"
            )
        return _screen_capture_pool


def set_screen_sharing(active: bool):
    global _screen_sharing_active
    with _screen_sharing_lock:
        _screen_sharing_active = bool(active)
        return {"active": _screen_sharing_active}


def is_screen_sharing_active():
    with _screen_sharing_lock:
        return _screen_sharing_active


def capture_screen_frame(quality=50, max_width=640):
    if not is_screen_sharing_active():
        return {"error": "Screen sharing is not active on PC. Enable screen preview first.", "active": False}
    try:
        import base64
        import ctypes
        from ctypes import wintypes
        import io
        from PIL import Image

        def _worker():
            user32 = ctypes.windll.user32
            gdi32 = ctypes.windll.gdi32

            hdesk = user32.OpenInputDesktop(0, False, 0x01FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)

            width = user32.GetSystemMetrics(0)
            height = user32.GetSystemMetrics(1)
            if width <= 0 or height <= 0:
                if hdesk:
                    user32.CloseDesktop(hdesk)
                return {"error": "Invalid display dimensions.", "active": False}

            # Fast hardware downscaling via StretchBlt
            tw = min(width, max_width) if max_width else width
            aspect = height / width
            th = int(tw * aspect) if max_width and width > max_width else height

            hdc_src = user32.GetDC(0)
            hdc_mem = gdi32.CreateCompatibleDC(hdc_src)
            hbm = gdi32.CreateCompatibleBitmap(hdc_src, tw, th)
            old_bm = gdi32.SelectObject(hdc_mem, hbm)

            if tw != width or th != height:
                gdi32.SetStretchBltMode(hdc_mem, 4)  # HALFTONE
                gdi32.SetBrushOrgEx(hdc_mem, 0, 0, None)
                ret = gdi32.StretchBlt(hdc_mem, 0, 0, tw, th, hdc_src, 0, 0, width, height, 0x00CC0020)
            else:
                ret = gdi32.BitBlt(hdc_mem, 0, 0, width, height, hdc_src, 0, 0, 0x00CC0020)

            if not ret:
                err = ctypes.GetLastError()
                gdi32.SelectObject(hdc_mem, old_bm)
                gdi32.DeleteObject(hbm)
                gdi32.DeleteDC(hdc_mem)
                user32.ReleaseDC(0, hdc_src)
                if hdesk:
                    user32.CloseDesktop(hdesk)
                return {"error": f"Screen capture failed (err={err}).", "active": False}

            class BITMAPINFOHEADER(ctypes.Structure):
                _fields_ = [
                    ('biSize', wintypes.DWORD),
                    ('biWidth', wintypes.LONG),
                    ('biHeight', wintypes.LONG),
                    ('biPlanes', wintypes.WORD),
                    ('biBitCount', wintypes.WORD),
                    ('biCompression', wintypes.DWORD),
                    ('biSizeImage', wintypes.DWORD),
                    ('biXPelsPerMeter', wintypes.LONG),
                    ('biYPelsPerMeter', wintypes.LONG),
                    ('biClrUsed', wintypes.DWORD),
                    ('biClrImportant', wintypes.DWORD)
                ]

            bmi = BITMAPINFOHEADER()
            bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bmi.biWidth = tw
            bmi.biHeight = -th  # top-down
            bmi.biPlanes = 1
            bmi.biBitCount = 24
            bmi.biCompression = 0

            buf = ctypes.create_string_buffer(tw * th * 3)
            gdi32.GetDIBits(hdc_mem, hbm, 0, th, buf, ctypes.byref(bmi), 0)

            gdi32.SelectObject(hdc_mem, old_bm)
            gdi32.DeleteObject(hbm)
            gdi32.DeleteDC(hdc_mem)
            user32.ReleaseDC(0, hdc_src)
            if hdesk:
                user32.CloseDesktop(hdesk)

            img = Image.frombytes('RGB', (tw, th), bytes(buf), 'raw', 'BGR')
            out_buf = io.BytesIO()
            img.save(out_buf, format="JPEG", quality=quality, optimize=True)
            return {
                "active": True,
                "image": base64.b64encode(out_buf.getvalue()).decode("ascii"),
                "width": img.width,
                "height": img.height
            }

        pool = _get_capture_pool()
        return pool.submit(_worker).result(timeout=2.5)
    except Exception as e:
        logger.warning("Screen capture failed: %s", e)
        return {"error": f"Screen capture unavailable in this session: {e}", "active": False}

