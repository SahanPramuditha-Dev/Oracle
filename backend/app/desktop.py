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
        self._lock = threading.RLock()
        self.open_url = open_url if open_url is not None else lambda url: webbrowser.open(url, new=2)

    @classmethod
    def from_env(cls):
        values = {**dotenv_values(Path(__file__).resolve().parents[1] / '.env'), **os.environ}
        names = [name.strip() for name in values.get('ORACLE_ALLOWED_APPS', '').split(',') if name.strip()]
        return cls(allowed_executables=names)

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
            ctypes.windll.user32.LockWorkStation()
            return {'status': 'ok', 'message': 'Workstation locked.'}
        except Exception as e:
            raise ActionError(f"LockWorkStation failed: {e}")

    def turn_off_display(self):
        try:
            import ctypes
            ctypes.windll.user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
            return {'status': 'ok', 'message': 'Display low-power sleep command sent.'}
        except Exception as e:
            raise ActionError(f"Display sleep command failed: {e}")

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
