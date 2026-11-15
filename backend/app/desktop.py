"""Discover and launch a small explicit allowlist; never accept executable paths from chat."""
import secrets
import shutil
import subprocess
import time
import threading
import os
import webbrowser
from urllib.parse import urlsplit
from pathlib import Path
from dotenv import dotenv_values

COMMON_WINDOWS_PATHS = {
    'chrome.exe': [
        Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe'),
        Path(r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'),
    ],
    'code.exe': [
        Path(os.path.expandvars(r'%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe')),
        Path(r'C:\Program Files\Microsoft VS Code\Code.exe'),
    ],
    'msedge.exe': [
        Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
        Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'),
    ],
}

APP_ALIASES = {
    'pet': 'oracle-pet',
    'desktop pet': 'oracle-pet',
    'oracle pet': 'oracle-pet',
    'vscode': 'code',
    'vs code': 'code',
    'visual studio code': 'code',
    'google chrome': 'chrome',
    'chrome': 'chrome',
    'calculator': 'calc',
    'edge': 'msedge',
    'microsoft edge': 'msedge',
}


class ActionError(Exception):
    pass


class DesktopActions:
    def __init__(self, apps=None, launch=None, allowed_executables=(), open_url=None):
        if apps is not None:
            self.apps = apps
        else:
            discovered = {}
            for name in allowed_executables:
                if Path(name).name == name and name.lower().endswith('.exe'):
                    if path := shutil.which(name):
                        discovered[Path(path).stem.lower()] = Path(path)
                    elif name.lower() in COMMON_WINDOWS_PATHS:
                        for cand in COMMON_WINDOWS_PATHS[name.lower()]:
                            if cand.is_file():
                                discovered[Path(cand).stem.lower()] = cand
                                break
            self.apps = discovered

        self.launch = launch if launch is not None else lambda path: subprocess.Popen([str(path)], shell=False)
        self.pending = {}
        self.restricted = False
        self._lock = threading.RLock()
        self.open_url = open_url if open_url is not None else lambda url: webbrowser.open(url, new=2)

    @classmethod
    def from_env(cls):
        values = {**dotenv_values(Path(__file__).resolve().parents[1] / '.env'), **os.environ}
        names = [name.strip() for name in values.get('ORACLE_ALLOWED_APPS', '').split(',') if name.strip()]
        desktop = cls(allowed_executables=names)
        pet_path = Path(values.get('ORACLE_PET_EXECUTABLE') or '')
        if pet_path.is_absolute() and pet_path.suffix.lower() == '.exe' and pet_path.is_file():
            desktop.apps['oracle-pet'] = pet_path
        return desktop

    def list_apps(self):
        return [{'id': app_id, 'name': path.stem} for app_id, path in self.apps.items() if path.is_file()]

    # --- Hardware & Vitals ---
    def get_vitals(self):
        import psutil
        cpu_pct = psutil.cpu_percent(interval=0.05)
        ram = psutil.virtual_memory()
        battery = psutil.sensors_battery()
        batt_str = f"{round(battery.percent)}% ({'Plugged in' if battery.power_plugged else 'Battery'})" if battery else "AC Desktop"

        gpu_data = None
        try:
            smi = subprocess.check_output(
                ['nvidia-smi', '--query-gpu=name,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
                text=True, timeout=2
            ).strip()
            if smi:
                name, temp, used, total = [x.strip() for x in smi.split(',')]
                gpu_data = {
                    'name': name,
                    'temp': f"{temp}°C",
                    'used_gb': round(float(used) / 1024, 1),
                    'total_gb': round(float(total) / 1024, 1),
                    'text': f"{name} is at {temp}°C, {round(float(used)/1024, 1)} GB of {round(float(total)/1024, 1)} GB VRAM used."
                }
        except Exception:
            pass

        return {
            'cpu': f"{cpu_pct}%",
            'ram': f"{round(ram.used / (1024**3), 1)} GB / {round(ram.total / (1024**3), 1)} GB ({ram.percent}%)",
            'battery': batt_str,
            'gpu': gpu_data
        }

    # --- Media Playback Controls ---
    def media_control(self, action: str):
        import ctypes
        VK_MAP = {
            'play_pause': 0xB3,
            'next': 0xB0,
            'prev': 0xB1,
            'stop': 0xB2,
        }
        vk = VK_MAP.get(action.lower())
        if not vk:
            raise ActionError(f"Unknown media action: {action}")
        try:
            user32 = ctypes.windll.user32
            user32.keybd_event(vk, 0, 0, 0)
            user32.keybd_event(vk, 0, 2, 0)
            return {'status': 'ok', 'action': action}
        except Exception as e:
            raise ActionError(f"Media key dispatch failed: {e}")

    # --- Display & Security ---
    def lock_workstation(self):
        try:
            import ctypes
            accepted = ctypes.windll.user32.LockWorkStation()
        except (AttributeError, OSError) as error:
            raise ActionError('Windows workstation locking is unavailable.') from error
        if not accepted:
            raise ActionError('Windows rejected the workstation lock request.')
        return {'status': 'requested', 'message': 'Windows accepted the workstation lock request.'}

    def restrict(self):
        with self._lock:
            self.restricted = True
            cancelled = len(self.pending)
            self.pending.clear()
            return cancelled

    def resume(self):
        with self._lock:
            self.restricted = False

    def turn_off_display(self):
        try:
            import ctypes
            ctypes.windll.user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
            return {'status': 'ok', 'message': 'Display low-power sleep command sent.'}
        except Exception as e:
            raise ActionError(f"Display sleep command failed: {e}")

    def sleep_pc(self):
        try:
            from . import companion_windows
            return companion_windows.sleep_pc()
        except Exception as e:
            raise ActionError(f"Sleep command failed: {e}")

    def hibernate_pc(self):
        try:
            from . import companion_windows
            return companion_windows.hibernate_pc()
        except Exception as e:
            raise ActionError(f"Hibernate command failed: {e}")

    def stay_awake(self, minutes: int = 60):
        try:
            from . import companion_windows
            return companion_windows.stay_awake(minutes)
        except Exception as e:
            raise ActionError(f"Stay awake request failed: {e}")

    def cancel_stay_awake(self):
        try:
            from . import companion_windows
            return companion_windows.cancel_stay_awake()
        except Exception as e:
            raise ActionError(f"Cancel stay awake failed: {e}")

    def show_desktop(self):
        try:
            import ctypes
            user32 = ctypes.windll.user32
            user32.keybd_event(0x5B, 0, 0, 0) # Win
            user32.keybd_event(0x44, 0, 0, 0) # D
            user32.keybd_event(0x44, 0, 2, 0)
            user32.keybd_event(0x5B, 0, 2, 0)
            return {'status': 'ok', 'message': 'Desktop toggled.'}
        except Exception as e:
            raise ActionError(f"Show desktop command failed: {e}")

    # --- Smart Clipboard ---
    def read_clipboard(self) -> str:
        try:
            import pyperclip
            return (pyperclip.paste() or '').strip()
        except Exception:
            return ''

    def copy_to_clipboard(self, text: str):
        try:
            import pyperclip
            pyperclip.copy(text)
            return {'status': 'ok', 'length': len(text)}
        except Exception as e:
            raise ActionError(f"Clipboard copy failed: {e}")

    # --- Volume Control ---
    def get_volume(self):
        try:
            from pycaw.pycaw import AudioUtilities
            speakers = AudioUtilities.GetSpeakers()
            vol = round(float(speakers.volume_percent))
            muted = bool(speakers.EndpointVolume.GetMute())
            return {'volume': vol, 'muted': muted}
        except Exception:
            return {'volume': 50, 'muted': False}

    def set_volume(self, percent: int):
        try:
            from pycaw.pycaw import AudioUtilities
            speakers = AudioUtilities.GetSpeakers()
            target = max(0, min(100, int(percent)))
            speakers.volume_percent = float(target)
            if speakers.EndpointVolume.GetMute():
                speakers.EndpointVolume.SetMute(0, None)
            return {'status': 'ok', 'volume': target, 'muted': False}
        except Exception as e:
            raise ActionError(f'Could not set volume: {e}')

    def set_mute(self, muted: bool):
        try:
            from pycaw.pycaw import AudioUtilities
            speakers = AudioUtilities.GetSpeakers()
            speakers.EndpointVolume.SetMute(1 if muted else 0, None)
            return {'status': 'ok', 'muted': bool(muted), 'volume': round(float(speakers.volume_percent))}
        except Exception as e:
            raise ActionError(f'Could not set mute state: {e}')

    # --- Proposals & Launching ---
    def propose(self, app_id):
        with self._lock:
            if self.restricted:
                raise ActionError('Desktop actions are restricted by Lockdown.')
            return self._propose(app_id)

    def _propose(self, app_id):
        now = time.monotonic()
        self.pending = {key: item for key, item in self.pending.items() if item['deadline'] > now}
        if len(self.pending) >= 20:
            raise ActionError('Too many pending requests. Cancel one or wait for it to expire.')
        if '://' in app_id:
            try:
                url = urlsplit(app_id)
                valid = url.scheme in ('http', 'https') and url.hostname and not url.username and not url.password
                _ = url.port
            except ValueError:
                valid = False
            if not valid or len(app_id) > 2048 or '\\' in app_id or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in app_id):
                raise ActionError('Use a complete HTTP or HTTPS URL without embedded credentials or spaces.')
            action_id = secrets.token_urlsafe(24)
            self.pending[action_id] = {'url': app_id, 'deadline': now + 60}
            return {'id': action_id, 'kind': 'website', 'name': app_id, 'expires_in_seconds': 60}
        app_id = app_id.lower().removesuffix('.exe')
        if app_id in APP_ALIASES:
            app_id = APP_ALIASES[app_id]
        if app_id not in self.apps:
            compact = ''.join(app_id.split())
            if compact in APP_ALIASES:
                app_id = APP_ALIASES[compact]
            elif compact in self.apps:
                app_id = compact
        if app_id not in self.apps or not self.apps[app_id].is_file():
            raise ActionError('That application is not in the available allowlist. Use the Applications panel, or specify a complete HTTPS website URL.')
        action_id = secrets.token_urlsafe(24)
        self.pending[action_id] = {'app_id': app_id, 'deadline': now + 60}
        return {'id': action_id, 'app_id': app_id, 'name': self.apps[app_id].stem, 'expires_in_seconds': 60}

    def cancel(self, action_id):
        with self._lock:
            self.pending.pop(action_id, None)

    def confirm(self, action_id):
        with self._lock:
            if self.restricted:
                raise ActionError('Desktop actions are restricted by Lockdown.')
            return self._confirm(action_id)

    def _confirm(self, action_id):
        item = self.pending.pop(action_id, None)
        if item is None or item['deadline'] <= time.monotonic():
            raise ActionError('This action expired or was already used. Prepare a new request.')
        if 'url' in item:
            try:
                opened = self.open_url(item['url'])
            except OSError:
                opened = False
            if not opened:
                raise ActionError('The system browser could not accept this URL.')
            return {'status': 'launch_requested', 'message': f'Browser launch requested for {item["url"]}.'}
        path = self.apps[item['app_id']]
        if not path.is_file():
            raise ActionError('The configured application is no longer available.')
        try:
            self.launch(path)
        except OSError:
            raise ActionError('Windows could not launch this application.') from None
        return {'status': 'launch_requested', 'message': f'Launch request sent to {path.stem}.'}

    # --- Window Management & Active Applications ---
    def list_open_windows(self):
        import ctypes
        import ctypes.wintypes
        import win32process
        import psutil

        user32 = ctypes.windll.user32
        hdesk = user32.OpenInputDesktop(0, False, 0x0100)
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        results = []
        fg_hwnd = user32.GetForegroundWindow()

        def enum_cb(hwnd, lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value.strip()

            ignored_prefixes = (
                'Default IME', 'MSCTFIME', 'GDI+', '.NET', 'MediaContext',
                'SystemResource', 'Program Manager', 'Settings', 'Windows Input Experience',
                'NVIDIA GeForce Overlay', 'BroadcastListenerWindow', 'Task Host Window',
                'DWM Notification Window', 'Hidden Window', 'CrossDevice', 'Intel'
            )
            if any(title.startswith(ig) for ig in ignored_prefixes):
                return True

            rect = ctypes.wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            if w < 60 or h < 60:
                return True

            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            pname = 'unknown'
            mem_mb = 0.0
            try:
                p = psutil.Process(pid)
                pname = p.name()
                mem_mb = round(p.memory_info().rss / (1024 * 1024), 1)
            except Exception:
                pass

            app_label = pname.removesuffix('.exe').capitalize()
            p_lower = pname.lower()
            if 'chrome' in p_lower:
                app_label = 'Google Chrome'
            elif 'code' in p_lower:
                app_label = 'VS Code'
            elif 'explorer' in p_lower:
                app_label = 'File Explorer'
            elif 'spotify' in p_lower:
                app_label = 'Spotify'
            elif 'antigravity' in p_lower:
                app_label = 'Antigravity'
            elif 'whatsapp' in p_lower:
                app_label = 'WhatsApp'

            results.append({
                'hwnd': int(hwnd),
                'title': title,
                'process': pname,
                'app_name': app_label,
                'pid': pid,
                'memory_mb': mem_mb,
                'is_active': (hwnd == fg_hwnd),
                'is_minimized': bool(user32.IsIconic(hwnd)),
                'is_maximized': bool(user32.IsZoomed(hwnd)),
                'rect': {'x': rect.left, 'y': rect.top, 'w': w, 'h': h}
            })
            return True

        if hdesk:
            user32.EnumDesktopWindows(hdesk, WNDENUMPROC(enum_cb), 0)
        else:
            user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

        results.sort(key=lambda item: (not item['is_active'], -item['memory_mb']))
        return results

    def get_active_window(self):
        import ctypes
        import win32process
        import psutil

        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return None
        length = user32.GetWindowTextLengthW(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        title = buff.value.strip()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        pname = 'unknown'
        try:
            pname = psutil.Process(pid).name()
        except Exception:
            pass
        return {'hwnd': int(hwnd), 'title': title, 'process': pname, 'pid': pid}

    def focus_window(self, hwnd: int):
        import ctypes
        import win32process

        user32 = ctypes.windll.user32
        if not user32.IsWindow(hwnd):
            raise ActionError("Target window is no longer available.")

        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        else:
            user32.ShowWindow(hwnd, 5)  # SW_SHOW

        fg_hwnd = user32.GetForegroundWindow()
        cur_thread, _ = win32process.GetWindowThreadProcessId(fg_hwnd)
        target_thread, _ = win32process.GetWindowThreadProcessId(hwnd)

        if cur_thread != target_thread:
            user32.AttachThreadInput(cur_thread, target_thread, True)
            user32.keybd_event(0x12, 0, 0, 0)
            user32.keybd_event(0x12, 0, 2, 0)
            user32.SetForegroundWindow(hwnd)
            user32.BringWindowToTop(hwnd)
            user32.AttachThreadInput(cur_thread, target_thread, False)
        else:
            user32.SetForegroundWindow(hwnd)
            user32.BringWindowToTop(hwnd)

        return {'status': 'ok', 'hwnd': hwnd}

    def tile_window(self, hwnd: int, side: str):
        import ctypes
        import ctypes.wintypes
        user32 = ctypes.windll.user32
        if not user32.IsWindow(hwnd):
            raise ActionError("Target window is no longer available.")

        rect = ctypes.wintypes.RECT()
        user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)  # SPI_GETWORKAREA
        work_w = rect.right - rect.left
        work_h = rect.bottom - rect.top
        x_off = rect.left
        y_off = rect.top

        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)

        side_l = side.lower()
        if side_l == 'left':
            nx, ny, nw, nh = x_off, y_off, work_w // 2, work_h
        elif side_l == 'right':
            nx, ny, nw, nh = x_off + (work_w // 2), y_off, work_w // 2, work_h
        elif side_l == 'top':
            nx, ny, nw, nh = x_off, y_off, work_w, work_h // 2
        elif side_l == 'bottom':
            nx, ny, nw, nh = x_off, y_off + (work_h // 2), work_w, work_h // 2
        else:
            raise ActionError(f"Unsupported tile layout: {side}")

        user32.MoveWindow(hwnd, nx, ny, nw, nh, True)
        self.focus_window(hwnd)
        return {'status': 'ok', 'rect': {'x': nx, 'y': ny, 'w': nw, 'h': nh}}

    def set_window_state(self, hwnd: int, state: str):
        import ctypes
        user32 = ctypes.windll.user32
        if not user32.IsWindow(hwnd):
            raise ActionError("Target window is no longer available.")

        st = state.lower()
        if st == 'minimize':
            user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
        elif st == 'maximize':
            user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
        elif st == 'restore':
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        elif st == 'close':
            user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
        else:
            raise ActionError(f"Unsupported window state: {state}")
        return {'status': 'ok', 'hwnd': hwnd, 'state': st}
