"""Oracle Companion LAN gateway and Windows console client."""
import base64
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode, urlsplit

from dotenv import dotenv_values

from .live_answers import (
    CALENDAR_QUESTION, CALENDAR_TOMORROW, DEPARTURE_QUESTION, MEETING_LOCATION, NEXT_REMINDER,
    REMINDER_QUESTION, ROUTE_QUESTION, TIMER_QUESTION, correct_question, live_answer,
    normalize_question, resolve_follow_up,
)

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/companion/v1"
TTL = 120
LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                        urllib.request.HTTPSHandler(context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)))

try:
    import psutil
    psutil.cpu_percent(interval=None)
except ImportError:
    psutil = None


def get_device_health():
    try:
        from .companion_telemetry import TelemetryEngine
        snap = TelemetryEngine.get_instance().get_snapshot()
        return {
            "cpuPercent": snap.get("cpu", {}).get("usagePercent", 0.0),
            "ramPercent": snap.get("memory", {}).get("usagePercent", 0.0),
            "sampledAt": int(time.time()),
        }
    except Exception:
        pass
    if psutil:
        try:
            return {
                "cpuPercent": round(psutil.cpu_percent(interval=0.05), 1),
                "ramPercent": round(psutil.virtual_memory().percent, 1),
                "sampledAt": int(time.time()),
            }
        except Exception:
            pass
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ('dwLength', ctypes.c_ulong),
                ('dwMemoryLoad', ctypes.c_ulong),
                ('ullTotalPhys', ctypes.c_ulonglong),
                ('ullAvailPhys', ctypes.c_ulonglong),
                ('ullTotalPageFile', ctypes.c_ulonglong),
                ('ullAvailPageFile', ctypes.c_ulonglong),
                ('ullTotalVirtual', ctypes.c_ulonglong),
                ('ullAvailVirtual', ctypes.c_ulonglong),
                ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
            ]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return {
            "cpuPercent": 0.0,
            "ramPercent": round(float(stat.dwMemoryLoad), 1),
            "sampledAt": int(time.time()),
        }
    except Exception:
        return None


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def local_json(port, path, body=None, token=None, timeout=6, content_type="application/json", method=None):
    headers = {"Content-Type": content_type}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else body if isinstance(body, bytes) else json.dumps(body).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with LOCAL_HTTP.open(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
            message = payload.get("detail") or payload.get("message")
        except (ValueError, AttributeError):
            message = None
        raise Problem(error.code, message if isinstance(message, str) else "Oracle rejected the request.") from None
    except (OSError, ValueError):
        raise Problem(503, "The local Oracle service did not respond.") from None


def resolve_control_voice_intent(text: str, gateway, device: str):
    import re
    raw = text.strip()
    clean = re.sub(r'^(?:oracle\s*,?\s*|hey\s+oracle\s*,?\s*|please\s*)', '', raw, flags=re.I).strip().lower()

    # Lock PC
    if re.fullmatch(r"lock(?:\s+my|\s+the)?\s+(?:pc|computer|workstation|screen)", clean):
        try:
            gateway.execute_control_command(device, "power.lock", {})
            return "I’ve locked your Windows workstation."
        except Exception as e:
            return f"Could not lock PC: {e}"

    # Master Volume
    if m := re.fullmatch(r"(?:set(?:\s+the|\s+my)?\s+)?(?:pc\s+|computer\s+)?volume\s+(?:to\s+)?(\d{1,3})(?:\s*%|\s*percent)?", clean):
        pct = max(0, min(100, int(m.group(1))))
        try:
            gateway.execute_control_command(device, "audio.set_volume", {"percent": pct})
            return f"PC master volume set to {pct}%."
        except Exception as e:
            return f"Could not change volume: {e}"

    if m := re.fullmatch(r"volume\s+(\d{1,3})(?:\s*%|\s*percent)?", clean):
        pct = max(0, min(100, int(m.group(1))))
        try:
            gateway.execute_control_command(device, "audio.set_volume", {"percent": pct})
            return f"PC master volume set to {pct}%."
        except Exception as e:
            return f"Could not change volume: {e}"

    # Mute / Unmute
    if re.fullmatch(r"mute(?:\s+my|\s+the)?\s+(?:pc|computer|audio|sound)?", clean):
        try:
            gateway.execute_control_command(device, "audio.set_mute", {"muted": True})
            return "PC audio has been muted."
        except Exception as e:
            return f"Could not mute audio: {e}"

    if re.fullmatch(r"unmute(?:\s+my|\s+the)?\s+(?:pc|computer|audio|sound)?", clean):
        try:
            gateway.execute_control_command(device, "audio.set_mute", {"muted": False})
            return "PC audio has been unmuted."
        except Exception as e:
            return f"Could not unmute audio: {e}"

    # Media Playback
    if re.fullmatch(r"(?:pause|resume|play|toggle)\s+(?:the\s+)?(?:music|song|track|playback|media)", clean):
        try:
            gateway.execute_control_command(device, "media.play_pause", {})
            return "Media playback toggled."
        except Exception as e:
            return f"Media command failed: {e}"

    if re.fullmatch(r"(?:play\s+)?(?:the\s+)?next\s+(?:song|track|music)", clean):
        try:
            gateway.execute_control_command(device, "media.next", {})
            return "Skipped to the next track."
        except Exception as e:
            return f"Media command failed: {e}"

    if re.fullmatch(r"(?:play\s+)?(?:the\s+)?(?:previous|prev)\s+(?:song|track|music)", clean):
        try:
            gateway.execute_control_command(device, "media.prev", {})
            return "Skipped to the previous track."
        except Exception as e:
            return f"Media command failed: {e}"

    # Display Off
    if re.fullmatch(r"turn\s+off(?:\s+the)?\s+(?:display|screen|monitor)", clean):
        try:
            gateway.execute_control_command(device, "power.display_off", {})
            return "Display low-power sleep command dispatched. Windows remains active."
        except Exception as e:
            return f"Could not turn display off: {e}"

    # Stay Awake
    if m := re.fullmatch(r"(?:stay\s+awake|keep(?:\s+the)?\s+(?:pc|computer)\s+awake)(?:\s+for\s+(\d+)\s*(minutes?|hours?))?", clean):
        num = int(m.group(1)) if m.group(1) else 60
        unit = m.group(2) if m.group(2) else "minutes"
        mins = num * 60 if "hour" in unit else num
        try:
            gateway.execute_control_command(device, "power.stay_awake", {"minutes": mins})
            return f"Stay-awake enabled for {num} {unit}."
        except Exception as e:
            return f"Could not set stay-awake: {e}"

    if re.fullmatch(r"(?:cancel\s+stay\s+awake|allow\s+sleep)", clean):
        try:
            gateway.execute_control_command(device, "power.cancel_stay_awake", {})
            return "Stay-awake disabled; normal Windows sleep policy restored."
        except Exception as e:
            return f"Could not cancel stay-awake: {e}"

    # Schedule Shutdown
    if m := re.fullmatch(r"shut\s*down(?:\s+the|\s+my)?\s+(?:pc|computer)?\s*in\s+(\d+)\s*(minutes?|hours?)", clean):
        num = int(m.group(1))
        unit = m.group(2)
        mins = num * 60 if "hour" in unit else num
        try:
            gateway.scheduler.create_schedule("shutdown", "countdown", minutes=mins, owner=device)
            return f"Shutdown scheduled for {num} {unit} from now. You can cancel it anytime."
        except Exception as e:
            return f"Could not schedule shutdown: {e}"

    if re.fullmatch(r"cancel(?:\s+my|\s+the)?\s+(?:shutdown(?:\s+timer)?|scheduled\s+shutdown|power\s+schedule)", clean):
        next_s = gateway.scheduler.get_next_scheduled_action()
        if next_s:
            try:
                gateway.scheduler.cancel_schedule(next_s["id"], owner=device)
                return "Scheduled shutdown has been cancelled."
            except Exception as e:
                return f"Could not cancel schedule: {e}"
        return "No scheduled shutdown is currently pending."

    # Running Applications
    if re.fullmatch(r"(?:show|what|list)(?:\s+are)?(?:\s+my)?\s+running\s+(?:apps|applications|windows)", clean):
        from . import companion_windows
        apps = companion_windows.list_running_applications()
        if not apps:
            return "No visible applications are open in your current session."
        names = [a.get("title") or a.get("process") for a in apps[:6]]
        return f"Open applications: {', '.join(names)}."

    # Routines
    if m := re.fullmatch(r"(?:activate|start|run|enable)\s+(study\s+mode|night\s+mode|presentation\s+mode|gaming\s+mode)", clean):
        mode = m.group(1).title()
        routine_map = {
            "Study Mode": "builtin_study_mode",
            "Night Mode": "builtin_night_mode",
            "Presentation Mode": "builtin_presentation_mode",
            "Gaming Mode": "builtin_gaming_mode"
        }
        rid = routine_map.get(mode)
        if rid:
            try:
                gateway.routines.execute_routine(rid, owner=device)
                return f"Activated {mode}."
            except Exception as e:
                return f"Failed to activate {mode}: {e}"

    # Power Safety Confirmations
    if re.fullmatch(r"(?:shut\s*down|turn\s+off)(?:\s+the|\s+my)?\s+(?:pc|computer)", clean):
        return "Shutting down will close your active applications. Say 'confirm shutdown' or use the Power page to proceed."
    if re.fullmatch(r"confirm\s+shutdown", clean):
        gateway.execute_control_command(device, "power.shutdown", {})
        return "Windows is shutting down now."

    if re.fullmatch(r"(?:restart|reboot)(?:\s+the|\s+my)?\s+(?:pc|computer)", clean):
        return "Restarting will disconnect Oracle Companion temporarily. Say 'confirm restart' or use the Power page to proceed."
    if re.fullmatch(r"confirm\s+restart", clean):
        gateway.execute_control_command(device, "power.restart", {})
        return "Windows is restarting now."

    if re.fullmatch(r"(?:sleep|suspend)(?:\s+the|\s+my)?\s+(?:pc|computer)", clean):
        return "Putting your PC to sleep will pause Oracle until you wake it from the desk. Say 'confirm sleep' or use the Power page to proceed."
    if re.fullmatch(r"confirm\s+sleep", clean):
        gateway.execute_control_command(device, "power.sleep", {})
        return "Sleep command sent to Windows."

    return None


class Gateway:
    def __init__(self, directory, oracle):
        self.directory = directory
        self.oracle = oracle
        self.name = socket.gethostname()
        self.generating = threading.Lock()
        directory.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS codes (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS devices (hash TEXT PRIMARY KEY, id TEXT NOT NULL, label TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS device_presence (
                    device_id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL, transport TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS pairing_receipts (code_hash TEXT PRIMARY KEY, label TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS trip_handoffs (
                    device_id TEXT PRIMARY KEY, id TEXT NOT NULL, destination TEXT NOT NULL,
                    url TEXT NOT NULL, expires INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                    sequence INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
                    text TEXT NOT NULL, reply_to TEXT UNIQUE, state TEXT NOT NULL DEFAULT 'complete'
                );
                CREATE TABLE IF NOT EXISTS actions (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL,
                    status TEXT NOT NULL, message TEXT NOT NULL
                );
            """)

        from .companion_scheduler import CompanionScheduler
        from .companion_routines import RoutineEngine
        self.scheduler = CompanionScheduler(self.db, self._dispatch_scheduled_action)
        self.routines = RoutineEngine(self.db, self.dispatch_control_action)
        self._dedup_cache = {}
        self._dedup_lock = threading.Lock()
        self._state_cache = None
        self._state_cache_time = 0.0
        self._state_cache_lock = threading.Lock()

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.directory / "companion.db")
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def recover(self):
        with self.db() as db:
            db.execute("UPDATE messages SET state='failed' WHERE state='pending'")
            db.execute("UPDATE actions SET status='unknown', message=? WHERE status='confirming'",
                       ("Windows outcome could not be verified after restart.",))

    def issue(self):
        code = secrets.token_urlsafe(24)
        with self.db() as db:
            db.execute("DELETE FROM codes")
            db.execute("DELETE FROM pairing_receipts")
            db.execute("INSERT INTO codes VALUES (?, ?)", (digest(code), int(time.time()) + TTL))
        return code

    def pair(self, code, label):
        credential, device = secrets.token_urlsafe(32), str(uuid.uuid4())
        with self.db() as db:
            used = db.execute("DELETE FROM codes WHERE hash=? AND expires>?", (digest(code), time.time()))
            if used.rowcount != 1:
                raise Problem(403, "Pairing code expired or already used. Create a new one on Windows.")
            db.execute("INSERT INTO devices VALUES (?, ?, ?)", (digest(credential), device, label[:60]))
            db.execute("INSERT INTO pairing_receipts VALUES (?, ?)", (digest(code), label[:60]))
        return {"token": credential, "pc": self.name}

    def paired_label(self, code_hash):
        with self.db() as db:
            row = db.execute("SELECT label FROM pairing_receipts WHERE code_hash=?", (code_hash,)).fetchone()
        return row["label"] if row else None

    def device(self, credential, transport=None):
        with self.db() as db:
            row = db.execute("SELECT id FROM devices WHERE hash=?", (digest(credential),)).fetchone()
            if row and transport:
                db.execute("""
                    INSERT INTO device_presence SELECT id, ?, ? FROM devices WHERE hash=?
                    ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen, transport=excluded.transport
                """, (int(time.time()), transport, digest(credential)))
        if not row:
            raise Problem(401, "Pair this phone again from Windows.")
        return row["id"]

    def devices(self):
        with self.db() as db:
            return [dict(row) for row in db.execute("""
                SELECT id, label, last_seen AS lastSeen, transport
                FROM devices LEFT JOIN device_presence ON id=device_id
                ORDER BY last_seen DESC, label, id
            """)]

    def revoke(self, device):
        with self.db() as db:
            removed = db.execute("DELETE FROM devices WHERE id=?", (device,)).rowcount
            db.execute("DELETE FROM device_presence WHERE device_id=?", (device,))
            db.execute("DELETE FROM trip_handoffs WHERE device_id=?", (device,))
        return bool(removed)

    def queue_trip(self, device, destination, url):
        with self.db() as db:
            db.execute("DELETE FROM trip_handoffs WHERE expires<=?", (time.time(),))
            queued = db.execute("""
                INSERT INTO trip_handoffs
                SELECT id, ?, ?, ?, ? FROM devices WHERE id=?
                ON CONFLICT(device_id) DO UPDATE SET id=excluded.id,
                    destination=excluded.destination, url=excluded.url, expires=excluded.expires
            """, (str(uuid.uuid4()), destination, url, int(time.time()) + 900, device))
            return bool(queued.rowcount)

    def latest_trip(self, device):
        with self.db() as db:
            row = db.execute("""
                SELECT trip.id, trip.destination, trip.url, trip.expires
                FROM trip_handoffs AS trip JOIN devices ON devices.id=trip.device_id
                WHERE trip.device_id=? AND trip.expires>?
            """, (device, time.time())).fetchone()
            return {"trip": dict(row) if row else None}

    def api_token(self):
        try:
            token = (self.oracle / "data/dev/api-token").read_text(encoding="utf-8").strip()
        except OSError:
            raise Problem(503, "Start Oracle and prepare its local API credential.") from None
        if not token:
            raise Problem(503, "Oracle local API credential is empty.")
        return token

    def capabilities(self):
        token = self.api_token()
        return token, local_json(8000, "/api/v1/capabilities", token=token)

    def ollama_port(self):
        values = dotenv_values(self.oracle / "backend/.env")
        configured = os.environ.get("OLLAMA_BASE_URL", values.get("OLLAMA_BASE_URL") or "http://127.0.0.1:11434")
        try:
            url = urlsplit(configured)
            if (url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost"}
                    and not (url.username or url.password or url.query or url.fragment)
                    and not url.path.strip("/")):
                return url.port if url.port is not None else 80
        except ValueError:
            pass
        raise Problem(503, "Companion chat requires a local Ollama HTTP address.")

    def status(self):
        try:
            _, capabilities = self.capabilities()
        except Problem:
            return {"pc": self.name, "oracle": False, "model": False, "action": False}
        model = capabilities.get("model", {})
        try:
            tags = local_json(self.ollama_port(), "/api/tags", timeout=2)
            name = model.get("name")
            ready = model.get("processing") == "local" and bool(name) and any(
                item.get("name") in (name, f"{name}:latest") for item in tags.get("models", [])
            )
        except Problem:
            ready = False
        health = get_device_health()
        res = {
            "pc": self.name, "oracle": True, "model": ready, "action": True,
            "pcControls": os.name == "nt",
            "modelName": model.get("name") if ready else None,
            "chatStreaming": True,
            "atlasAction": True,
            "replyModes": ready and name.split(":", 1)[0].rsplit("/", 1)[-1].lower() == "qwen3"
        }
        if hasattr(self, "scheduler"):
            next_s = self.scheduler.get_next_scheduled_action()
            if next_s:
                res["scheduled"] = next_s
        if health:
            res["deviceHealth"] = health
        return res

    def history(self, reply_to=None):
        with self.db() as db:
            rows = db.execute(
                "SELECT id,role,text,state FROM messages ORDER BY sequence DESC LIMIT 100"
            ).fetchall()
            reply = None if reply_to is None else db.execute(
                "SELECT id,role,text,state FROM messages WHERE reply_to=? AND state='complete'",
                (reply_to,),
            ).fetchone()
        result = {"messages": [dict(row) for row in reversed(rows)]}
        if reply is not None:
            result["reply"] = dict(reply)
        return result

    def send(self, identity, text, mode="quick", emit=None, device="companion"):
        if mode not in ("quick", "deep"):
            raise Problem(400, "Invalid reply mode.")
        if not self.generating.acquire(blocking=False):
            raise Problem(409, "Oracle is answering another message. Try again shortly.")
        try:
            with self.db() as db:
                db.execute("BEGIN IMMEDIATE")
                existing = db.execute("SELECT role,text,state FROM messages WHERE id=?", (identity,)).fetchone()
                if existing and (existing["role"] != "user" or existing["text"] != text):
                    raise Problem(409, "This message ID already belongs to another message.")
                if existing and existing["state"] == "complete":
                    return self.history(reply_to=identity)
                if db.execute("SELECT 1 FROM messages WHERE state='pending'").fetchone():
                    raise Problem(409, "Oracle is answering another message. Try again shortly.")
                rows = db.execute(
                    "SELECT role,text FROM messages WHERE state='complete' ORDER BY sequence DESC LIMIT 8"
                ).fetchall()
                db.execute("INSERT INTO messages(id,role,text,state) VALUES (?,'user',?,'pending') "
                           "ON CONFLICT(id) DO UPDATE SET state='pending'", (identity, text))
            try:
                previous_question = next((row["text"] for row in rows if row["role"] == "user"), None)
                resolved = resolve_follow_up(text, previous_question)
                reply = live_answer(resolved)
                if reply is None:
                    reply = resolve_control_voice_intent(resolved, self, device)
                if reply is None:
                    query = normalize_question(correct_question(resolved))
                    if any(pattern.fullmatch(query) for pattern in (
                        CALENDAR_QUESTION, CALENDAR_TOMORROW, MEETING_LOCATION, NEXT_REMINDER, REMINDER_QUESTION, TIMER_QUESTION,
                    )):
                        result = local_json(8000, "/api/v1/chat", {"text": query}, self.api_token(), timeout=20)
                        reply = result["message"]
                    elif ROUTE_QUESTION.fullmatch(query) or DEPARTURE_QUESTION.fullmatch(query):
                        reply = "Driving estimates from your current location are available in Oracle Central desktop chat."
                if reply is None:
                    _, capabilities = self.capabilities()
                    model = capabilities.get("model", {})
                    if model.get("processing") != "local" or not model.get("name"):
                        raise Problem(503, "Configure a local Ollama model in Oracle to use companion chat.")
                    context = [{"role": "assistant" if row["role"] == "model" else "user",
                                "content": row["text"][:4000]} for row in reversed(rows)]
                    context.append({"role": "user", "content": text})
                    payload = {"model": model["name"], "stream": False, "messages": context,
                               "options": {"num_predict": 1024 if mode == "deep" else 512}}
                    if model["name"].split(":", 1)[0].rsplit("/", 1)[-1].lower() == "qwen3":
                        payload["think"] = mode == "deep"
                    result = local_json(self.ollama_port(), "/api/chat", payload, timeout=80)
                    reply = result.get("message", {}).get("content", "").strip()
                    if not reply:
                        raise Problem(502, "The local model returned an empty answer.")
                with self.db() as db:
                    db.execute("INSERT INTO messages(id,role,text,reply_to) VALUES (?,'model',?,?) ON CONFLICT(reply_to) DO UPDATE SET text=excluded.text,state='complete'",
                               (str(uuid.uuid4()), reply[:12000], identity))
                    db.execute("UPDATE messages SET state='complete' WHERE id=?", (identity,))
            except Exception:
                with self.db() as db:
                    db.execute("UPDATE messages SET state='failed' WHERE id=?", (identity,))
                    if locals().get("partial"):
                        db.execute("INSERT INTO messages(id,role,text,reply_to,state) VALUES (?,'model',?,?,'partial') "
                                   "ON CONFLICT(reply_to) DO UPDATE SET text=excluded.text,state='partial'",
                                   (str(uuid.uuid4()), partial, identity))
                raise
            return self.history(reply_to=identity)
        finally:
            self.generating.release()

    def propose(self, device, target="vscode"):
        if target not in ("vscode", "atlas"):
            raise Problem(400, "Unknown desktop action.")
        name = "Atlas" if target == "atlas" else "VS Code"
        app_id = "http://127.0.0.1:5173/?companionView=atlas" if target == "atlas" else "vscode"
        token, _ = self.capabilities()
        action = local_json(8000, "/api/v1/actions/propose", {"app_id": app_id}, token)
        with self.db() as db:
            db.execute("INSERT INTO actions VALUES (?,?,?,'pending',?)",
                       (action["id"], device, int(time.time()) + action["expires_in_seconds"],
                        f"Confirm Open {name}."))
        return {"id": action["id"], "pc": self.name}

    def confirm(self, device, identity):
        token, _ = self.capabilities()
        with self.db() as db:
            pending = db.execute("SELECT message FROM actions WHERE id=? AND owner=?",
                                 (identity, device)).fetchone()
            updated = db.execute("UPDATE actions SET status='confirming', message=? "
                                 "WHERE id=? AND owner=? AND status='pending' AND expires>?",
                                 ("Waiting for Windows.", identity, device, time.time()))
            if updated.rowcount != 1:
                raise Problem(409, "This action expired or was already submitted. Check Activity.")
        try:
            result = local_json(8000, f"/api/v1/actions/{identity}/confirm", {}, token)
            status = result.get("status")
            if status == "launch_requested":
                message = (
                    "Windows accepted the Atlas browser launch request. Atlas visibility is unverified."
                    if pending["message"] == "Confirm Open Atlas."
                    else "Windows accepted the VS Code launch request. Window visibility is unverified."
                )
            else:
                status, message = "unknown", "Windows returned an unrecognized launch result."
        except Problem as error:
            status = "unknown" if error.status >= 500 else "failed"
            message = error.message
        with self.db() as db:
            db.execute("UPDATE actions SET status=?, message=? WHERE id=?", (status, message, identity))
        return {"status": status, "message": message}

    def activity(self, device):
        with self.db() as db:
            rows = db.execute("SELECT status,message FROM actions WHERE owner=? AND status!='pending' "
                              "ORDER BY rowid DESC LIMIT 25", (device,)).fetchall()
        return {"events": [dict(row) for row in rows]}

    def _dispatch_scheduled_action(self, action, owner):
        return self.dispatch_control_action(action, {}, owner)

    def dispatch_control_action(self, action, params, owner):
        if os.name != "nt":
            raise Problem(501, "PC controls require Windows.")
        with self._state_cache_lock:
            self._state_cache_time = 0.0
        from . import companion_windows
        act = action.lower().strip()

        # Power
        if act in ("power.lock", "lock"):
            return companion_windows.lock_workstation()
        if act in ("power.sleep", "sleep"):
            return companion_windows.sleep_pc()
        if act in ("power.hibernate", "hibernate"):
            return companion_windows.hibernate_pc()
        if act in ("power.shutdown", "shutdown"):
            return companion_windows.shutdown_pc(restart=False)
        if act in ("power.restart", "restart"):
            return companion_windows.shutdown_pc(restart=True)
        if act in ("power.sign_out", "sign_out"):
            return companion_windows.sign_out()
        if act in ("power.display_off", "turn_off_display", "display_off"):
            return companion_windows.turn_off_display()
        if act in ("power.stay_awake", "stay_awake"):
            mins = int(params.get("minutes", 60))
            return companion_windows.stay_awake(duration_minutes=mins)
        if act in ("power.cancel_stay_awake", "cancel_stay_awake"):
            return companion_windows.stay_awake(cancel=True)
        if act in ("power.schedule", "schedule"):
            sched_act = str(params.get("action", "shutdown"))
            mode = str(params.get("mode", "countdown"))
            mins = params.get("minutes")
            due = params.get("due")
            rec = params.get("recurrence")
            return self.scheduler.create_schedule(sched_act, mode, minutes=mins, due_time=due, recurrence=rec, owner=owner)
        if act in ("schedule.cancel", "cancel_schedule", "power.cancel_schedule"):
            sid = params.get("id")
            if sid:
                return self.scheduler.cancel_schedule(sid)
            next_s = self.scheduler.get_next_scheduled_action()
            if next_s:
                return self.scheduler.cancel_schedule(next_s["id"])
            return {"status": "ok", "message": "No active schedule to cancel."}

        # Audio
        if act in ("audio.set_volume", "set_volume"):
            pct = int(params.get("percent", 50))
            return companion_windows.set_master_volume(pct)
        if act in ("audio.set_mute", "set_mute"):
            muted = bool(params.get("muted", True))
            return companion_windows.set_master_mute(muted)
        if act in ("audio.volume_up", "volume_up"):
            return companion_windows.send_media_action("volume_up")
        if act in ("audio.volume_down", "volume_down"):
            return companion_windows.send_media_action("volume_down")
        if act in ("audio.mute_toggle", "mute"):
            return companion_windows.send_media_action("mute")
        if act in ("audio.set_mic_mute", "set_mic_mute"):
            muted = bool(params.get("muted", True))
            return companion_windows.set_microphone_mute(muted)
        if act in ("audio.set_app_volume", "set_app_volume"):
            pid = int(params.get("pid", 0))
            pct = int(params.get("percent", 50))
            muted = params.get("muted")
            return companion_windows.set_app_volume(pid, pct, muted)

        # Media
        if act in ("media.play", "play"):
            return companion_windows.send_media_action("play")
        if act in ("media.pause", "pause"):
            return companion_windows.send_media_action("pause")
        if act in ("media.play_pause", "play_pause"):
            return companion_windows.send_media_action("play_pause")
        if act in ("media.next", "next"):
            return companion_windows.send_media_action("next")
        if act in ("media.prev", "media.previous", "prev", "previous"):
            return companion_windows.send_media_action("prev")
        if act in ("media.stop", "stop"):
            return companion_windows.send_media_action("stop")

        # Display
        if act in ("display.set_brightness", "set_brightness"):
            pct = int(params.get("percent", 50))
            return companion_windows.set_brightness(pct)
        if act in ("display.set_topology", "set_topology"):
            top = str(params.get("topology", "extend"))
            return companion_windows.set_display_topology(top)

        # Applications
        if act in ("app.launch", "launch"):
            target = str(params.get("app_id", "vscode"))
            prop = self.propose(owner, target=target)
            return self.confirm(owner, prop["id"])
        if act in ("app.window_state", "window_state"):
            hwnd = int(params.get("hwnd", 0))
            st = str(params.get("state", "focus"))
            return companion_windows.set_window_state(hwnd, st)
        if act in ("app.terminate", "terminate"):
            pid = int(params.get("pid", 0))
            force = bool(params.get("force", False))
            return companion_windows.terminate_application(pid, force=force)

        # Input
        if act == "input.mouse":
            etype = str(params.get("type", "move"))
            return companion_windows.send_mouse_input(
                etype,
                dx=params.get("dx", 0),
                dy=params.get("dy", 0),
                button=params.get("button", "left"),
                delta=params.get("delta", 0),
            )
        if act == "input.key":
            return companion_windows.send_keyboard_input("key", key=params.get("key"), vk=params.get("vk"))
        if act == "input.shortcut":
            return companion_windows.send_keyboard_input("shortcut", key=params.get("key"))
        if act == "input.text":
            return companion_windows.send_keyboard_input("text", text=params.get("text", ""))

        # Clipboard
        if act == "clipboard.read":
            return companion_windows.read_clipboard()
        if act == "clipboard.write":
            return companion_windows.write_clipboard(params.get("text", ""))
        if act == "clipboard.clear":
            return companion_windows.clear_clipboard()

        # WoL
        if act == "wol.send":
            mac = str(params.get("mac", ""))
            bcast = str(params.get("broadcast", "255.255.255.255"))
            return companion_windows.send_wol_packet(mac, broadcast=bcast)

        raise Problem(400, f"Unknown action: {action}")

    def execute_control_command(self, device, action, params, request_id=None):
        if request_id:
            with self._dedup_lock:
                now_m = time.monotonic()
                self._dedup_cache = {k: v for k, v in self._dedup_cache.items() if v["expires"] > now_m}
                if request_id in self._dedup_cache:
                    cached = dict(self._dedup_cache[request_id]["response"])
                    cached["duplicate"] = True
                    return cached

        cid = str(uuid.uuid4())
        now = int(time.time())
        with self.db() as db:
            db.execute(
                "INSERT INTO actions VALUES (?, ?, ?, 'executing', ?)",
                (cid, device, now + 60, f"Executing {action}."),
            )

        try:
            result = self.dispatch_control_action(action, params, device)
            msg = f"Action {action} completed successfully."
            if isinstance(result, dict) and "message" in result:
                msg = result["message"]
            with self.db() as db:
                db.execute("UPDATE actions SET status='completed', message=? WHERE id=?", (msg, cid))
            res_payload = {
                "command_id": cid,
                "status": "completed",
                "action": action,
                "result": result,
                "message": msg,
            }
            if request_id:
                with self._dedup_lock:
                    self._dedup_cache[request_id] = {
                        "expires": time.monotonic() + 120,
                        "response": res_payload
                    }
            return res_payload
        except Problem as error:
            with self.db() as db:
                db.execute("UPDATE actions SET status='failed', message=? WHERE id=?", (error.message, cid))
            raise
        except Exception as err:
            msg = f"Action failed: {err}"
            with self.db() as db:
                db.execute("UPDATE actions SET status='failed', message=? WHERE id=?", (msg, cid))
            raise Problem(500, msg) from err

    def device_capabilities(self):
        if os.name != "nt":
            return {"supported": False, "os": os.name}
        from . import companion_windows
        p_status = companion_windows.get_power_status()
        wake_caps = companion_windows.get_wake_capabilities()
        bright = companion_windows.get_brightness()
        return {
            "supported": True,
            "os": "Windows",
            "pc": self.name,
            "canLock": True,
            "canSleep": p_status["can_sleep"],
            "canHibernate": p_status["can_hibernate"],
            "canShutdown": True,
            "canRestart": True,
            "canSignOut": True,
            "canTurnOffDisplay": True,
            "canStayAwake": True,
            "canControlMasterVolume": True,
            "canControlMicrophone": True,
            "canControlAudioMixer": True,
            "canControlMediaSessions": True,
            "canControlBrightness": bright is not None,
            "brightness": bright,
            "canControlDisplays": True,
            "canManageApplications": True,
            "canManageWindows": True,
            "canSendRemoteInput": True,
            "canShareScreen": True,
            "canScheduleActions": True,
            "canRunRoutines": True,
            "wakeOnLanConfigured": wake_caps["configured"],
            "macAddresses": [a["mac"] for a in wake_caps["adapters"]],
        }

    def controls_state(self, force_refresh=False):
        if os.name != "nt":
            return {"supported": False}
        now = time.monotonic()
        with self._state_cache_lock:
            if not force_refresh and self._state_cache is not None and (now - self._state_cache_time) < 1.2:
                return dict(self._state_cache)

        from . import companion_windows
        power = companion_windows.get_power_status()
        volume = companion_windows.get_master_volume()
        mic = companion_windows.get_microphone_status()
        media = companion_windows.get_media_status()
        bright = companion_windows.get_brightness()
        next_sched = self.scheduler.get_next_scheduled_action()
        snap = {
            "supported": True,
            "pc": self.name,
            "uptime": power["uptime_seconds"],
            "battery": power["battery"],
            "stay_awake": power["stay_awake"],
            "can_sleep": power["can_sleep"],
            "can_hibernate": power["can_hibernate"],
            "volume": volume,
            "microphone": mic,
            "media": media,
            "brightness": bright,
            "scheduled": next_sched,
        }
        with self._state_cache_lock:
            self._state_cache = snap
            self._state_cache_time = now
        return dict(snap)

    def device_controls(self, device, command=None):
        if os.name != "nt":
            if command is not None:
                raise Problem(501, "PC controls require Windows.")
            return {"supported": False}
        if command is None:
            state = self.controls_state()
            next_s = state.get("scheduled")
            return {
                "supported": True,
                "brightness": state.get("brightness"),
                "sleep": state.get("can_sleep"),
                "hibernate": state.get("can_hibernate"),
                "battery": state.get("battery"),
                "volume": state.get("volume"),
                "stay_awake": state.get("stay_awake"),
                "canCancel": next_s is not None,
                "scheduled": next_s,
                "persistentSchedule": True,
            }
        action = command.get("action", "")
        if action == "schedule":
            mins = int(command.get("minutes", 15))
            sched = self.scheduler.create_schedule("shutdown", "countdown", minutes=mins, owner=device)
            return {"status": "scheduled", "message": f"Shutdown scheduled in {mins} minutes.", "schedule": sched}
        if action == "schedule_at":
            due = int(command.get("due", 0))
            sched = self.scheduler.create_schedule("shutdown", "exact_time", due_time=due, owner=device)
            return {"status": "scheduled", "message": "Shutdown scheduled.", "schedule": sched}
        if action == "cancel":
            next_s = self.scheduler.get_next_scheduled_action()
            if next_s:
                self.scheduler.cancel_schedule(next_s["id"])
                return {"status": "cancelled", "message": "Scheduled action cancelled."}
            return {"status": "ok", "message": "No active schedule to cancel."}

        params = {}
        if "percent" in command:
            params["percent"] = command["percent"]
        if "minutes" in command:
            params["minutes"] = command["minutes"]
        res = self.dispatch_control_action(action, params, device)
        msg = res.get("message") if isinstance(res, dict) else "Action executed."
        return {"status": "ok", "message": msg, "result": res}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(8)
        super().setup()

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.handle_api()

    def do_POST(self):
        self.handle_api()

    def do_PATCH(self):
        self.handle_api()

    def do_DELETE(self):
        self.handle_api()

    def body(self, limit=24_000):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= limit:
                raise Problem(413, "Request is too large.")
            result = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except ValueError:
            raise Problem(400, "Expected a JSON object.") from None

    def route(self):
        gateway = self.server.gateway
        parsed = urlsplit(self.path)
        raw_path = parsed.path
        query = parsed.query
        if not raw_path.startswith(PREFIX + "/"):
            raise Problem(404, "Unknown operation.")
        path = raw_path[len(PREFIX):]
        if self.command == "POST" and path == "/pair":
            body = self.body()
            return gateway.pair(field(body, "code", 64), field(body, "label", 60))
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer ") or len(header) > 128:
            raise Problem(401, "Pair this phone first.")
        device = gateway.device(header[7:], getattr(self.server, "transport", "lan"))
        if self.command == "POST" and path in {
            "/vision", "/vision/detect", "/vision/people", "/vision/read", "/vision/product",
        }:
            if path == "/vision/people" and getattr(self.server, "transport", "lan") != "lan":
                raise Problem(403, "People recognition is available on your local connection only.")
            body = self.body(175_000)
            try:
                photo = base64.b64decode(field(body, "image", 172_000), validate=True)
            except ValueError:
                raise Problem(400, "Invalid photo encoding.") from None
            if len(photo) > 128_000 or not photo.startswith(b"\xff\xd8"):
                raise Problem(415, "Send a JPEG photo up to 128 KB.")
            if path == "/vision/detect":
                return local_json(8000, "/api/v1/vision/detect", photo, gateway.api_token(),
                                  timeout=10, content_type="image/jpeg")
            if path == "/vision/people":
                scan = local_json(
                    8000, "/api/v1/people/identify?public_figures=false", photo,
                    gateway.api_token(), timeout=30, content_type="image/jpeg",
                )
                return {"identified": [
                    {"box": face.get("box"), "matched": face.get("matched") is True,
                     "name": face.get("name") if face.get("matched") is True else "Unknown",
                     "permission": face.get("permission") if face.get("matched") is True else None}
                    for face in scan.get("identified", [])[:40]
                ]}
            if path in {"/vision/read", "/vision/product"}:
                target, timeout = {
                    "/vision/read": ("/api/v1/images/read", 30),
                    "/vision/product": ("/api/v1/vision/products/inspect", 95),
                }[path]
                return local_json(8000, target, photo, gateway.api_token(),
                                  timeout=timeout, content_type="image/jpeg")
            prompt = field(body, "prompt", 1000)
            return local_json(
                8000, "/api/v1/vision/ask?" + urlencode({"prompt": prompt}), photo,
                gateway.api_token(), timeout=95, content_type="image/jpeg",
            )
        body = self.body() if self.command == "POST" else {}
        if self.command == "GET":
            if path == "/device/performance":
                from .companion_telemetry import TelemetryEngine
                engine = TelemetryEngine.get_instance(gateway.directory)
                snap = engine.get_snapshot()
                primary_gpu = snap.get("gpus", [{}])[0] if snap.get("gpus") else {}
                primary_vol = snap.get("storage", {}).get("volumes", [{}])[0] if snap.get("storage", {}).get("volumes") else {}
                return {
                    "memory": {"used": snap["memory"]["usedBytes"], "total": snap["memory"]["totalBytes"]},
                    "storage": {"used": primary_vol.get("usedBytes", 0), "total": primary_vol.get("totalBytes", 0)},
                    "gpu3d": primary_gpu.get("usagePercent", 0),
                    "network": {
                        "down": snap["network"]["downloadBytesPerSec"],
                        "up": snap["network"]["uploadBytesPerSec"]
                    },
                    "snapshot": snap
                }
            if path == "/monitor/overview":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot()
            if path == "/monitor/hardware":
                from .companion_telemetry import TelemetryEngine
                eng = TelemetryEngine.get_instance(gateway.directory)
                return {
                    "cpu": eng.cpu_meta,
                    "bios": eng.bios_meta,
                    "gpus": eng.gpus_meta,
                }
            if path == "/monitor/cpu":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("cpu", {})
            if path == "/monitor/memory":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("memory", {})
            if path == "/monitor/gpus":
                from .companion_telemetry import TelemetryEngine
                return {"gpus": TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("gpus", [])}
            if path == "/monitor/storage":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("storage", {})
            if path == "/monitor/network":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("network", {})
            if path == "/monitor/thermal":
                from .companion_telemetry import TelemetryEngine
                snap = TelemetryEngine.get_instance(gateway.directory).get_snapshot()
                return {"thermal": snap.get("thermal", []), "cooling": snap.get("cooling", [])}
            if path == "/monitor/processes":
                from .companion_telemetry import TelemetryEngine
                from urllib.parse import parse_qs
                params = parse_qs(query)
                sort_by = params.get("sort", ["cpu"])[0]
                limit = int(params.get("limit", [30])[0])
                search = params.get("search", [""])[0]
                return {"processes": TelemetryEngine.get_instance(gateway.directory).get_processes(sort_by, limit, search)}
            if path == "/monitor/system":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("system", {})
            if path == "/monitor/ai":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("ai", {})
            if path == "/monitor/services":
                from .companion_telemetry import TelemetryEngine
                return {"services": TelemetryEngine.get_instance(gateway.directory).get_snapshot().get("services", [])}
            if path == "/monitor/history":
                from .companion_telemetry import TelemetryEngine
                from urllib.parse import parse_qs
                params = parse_qs(query)
                window = int(params.get("window", [300])[0])
                points = int(params.get("points", [60])[0])
                return {"window": window, "points": TelemetryEngine.get_instance(gateway.directory).history.query_history(window, points)}
            if path == "/monitor/alerts":
                from .companion_telemetry import TelemetryEngine
                eng = TelemetryEngine.get_instance(gateway.directory)
                snap = eng.get_snapshot()
                return {"active": eng.alerts.evaluate(snap), "history": eng.alerts.get_history()}
            if path == "/monitor/settings":
                from .companion_telemetry import TelemetryEngine
                return TelemetryEngine.get_instance(gateway.directory).alerts.settings
            if path == "/monitor/stream":
                from .companion_telemetry import TelemetryEngine
                return self.stream_monitor(TelemetryEngine.get_instance(gateway.directory))
            if path == "/status":
                status = gateway.status()
                remote_address = getattr(self.server, "remote_address", None)
                if remote_address is not None:
                    status["remoteHost"] = remote_address()
                return status
            if path == "/chat":
                return gateway.history()
            if path == "/activity":
                return gateway.activity(device)
            if path == "/atlas/trip":
                return gateway.latest_trip(device)
            if path == "/controls/capabilities":
                return gateway.device_capabilities()
            if path.startswith("/controls/commands/"):
                cmd_id = path[len("/controls/commands/"):]
                with gateway.db() as db:
                    row = db.execute("SELECT id, owner, status, message FROM actions WHERE id=?", (cmd_id,)).fetchone()
                    if not row:
                        raise Problem(404, "Command not found.")
                    return {"command_id": row["id"], "status": row["status"], "message": row["message"]}
            if path == "/controls/state":
                return gateway.controls_state()
            if path == "/controls/schedules":
                return gateway.scheduler.list_schedules(include_history=True)
            if path == "/controls/routines":
                return {"routines": gateway.routines.list_routines()}
            if path == "/controls/routines/history":
                return {"history": gateway.routines.get_history()}
            if path == "/controls/clipboard":
                from . import companion_windows
                return companion_windows.read_clipboard()
            if path == "/controls/apps/running":
                from . import companion_windows
                return {"apps": companion_windows.list_running_applications()}
            if path == "/controls/audio/devices":
                from . import companion_windows
                return {"devices": companion_windows.list_audio_devices()}
            if path == "/controls/audio/sessions":
                from . import companion_windows
                return {"sessions": companion_windows.list_audio_sessions()}
            if path == "/controls/displays":
                from . import companion_windows
                return {"monitors": companion_windows.list_monitors(), "brightness": companion_windows.get_brightness()}
            if path == "/controls/screen/frame":
                from . import companion_windows
                return companion_windows.capture_screen_frame()
            if path == "/controls/screen/status":
                from . import companion_windows
                return {"active": companion_windows.is_screen_sharing_active()}
            if path == "/device/controls":
                return gateway.device_controls(device)
            if path == "/device/performance":
                from .companion_performance import performance_snapshot
                return performance_snapshot()
            if path in {"/records/tasks", "/tasks"}:
                due_only = "due_only=true" if "due_only=true" in query.lower() else ""
                target = "/api/v1/tasks" + (f"?{due_only}" if due_only else "")
                return local_json(8000, target, token=gateway.api_token())
            if path in {"/records/notes", "/notes"}:
                target = "/api/v1/notes" + (f"?{query}" if query else "")
                return local_json(8000, target, token=gateway.api_token())
            if path in {"/google/status", "/google"}:
                return local_json(8000, "/api/v1/google/status", token=gateway.api_token())
            if path == "/google/events":
                target = "/api/v1/google/events" + (f"?{query}" if query else "")
                return local_json(8000, target, token=gateway.api_token())
            if path == "/google/tasks":
                target = "/api/v1/google/tasks" + (f"?{query}" if query else "")
                return local_json(8000, target, token=gateway.api_token())
            if path in {"/geo/places", "/atlas/places"}:
                return local_json(8000, "/api/v1/geo/places", token=gateway.api_token())
            if path in {"/geo/parking", "/atlas/parking"}:
                return local_json(8000, "/api/v1/geo/parking", token=gateway.api_token())
            if path in {"/geo/search", "/atlas/search"}:
                target = "/api/v1/geo/search" + (f"?{query}" if query else "")
                return local_json(8000, target, token=gateway.api_token())
            if path in {"/geo/route", "/atlas/route"}:
                target = "/api/v1/geo/route" + (f"?{query}" if query else "")
                return local_json(8000, target, token=gateway.api_token())
            if path in {"/people", "/people/list"}:
                return local_json(8000, "/api/v1/people", token=gateway.api_token())
        elif self.command == "PATCH":
            if path.startswith("/google/tasks/"):
                task_id = path.rstrip("/").split("/")[-1]
                return local_json(8000, f"/api/v1/google/tasks/{task_id}", body=body, token=gateway.api_token(), method="PATCH")
            if path.startswith("/people/"):
                person_id = path.rstrip("/").split("/")[-1]
                return local_json(8000, f"/api/v1/people/{person_id}", body=body, token=gateway.api_token(), method="PATCH")
        elif self.command == "DELETE":
            if path.startswith("/controls/schedules/"):
                sched_id = path[len("/controls/schedules/"):]
                return gateway.scheduler.cancel_schedule(sched_id)
            if path.startswith("/controls/routines/"):
                routine_id = path[len("/controls/routines/"):]
                return gateway.routines.delete_routine(routine_id)
            if path.startswith("/records/tasks/") or path.startswith("/tasks/"):
                task_id = path.rstrip("/").split("/")[-1]
                return local_json(8000, f"/api/v1/tasks/{task_id}", token=gateway.api_token(), method="DELETE")
            if path.startswith("/records/notes/") or path.startswith("/notes/"):
                note_id = path.rstrip("/").split("/")[-1]
                return local_json(8000, f"/api/v1/notes/{note_id}", token=gateway.api_token(), method="DELETE")
            if path.startswith("/geo/places/") or path.startswith("/atlas/places/"):
                place_id = path.rstrip("/").split("/")[-1]
                return local_json(8000, f"/api/v1/geo/places/{place_id}", token=gateway.api_token(), method="DELETE")
            if path in {"/geo/parking", "/atlas/parking"}:
                return local_json(8000, "/api/v1/geo/parking", token=gateway.api_token(), method="DELETE")
            if path.startswith("/people/"):
                person_id = path.rstrip("/").split("/")[-1]
                return local_json(8000, f"/api/v1/people/{person_id}", token=gateway.api_token(), method="DELETE")
        else:
            if path == "/chat":
                try:
                    identity = str(uuid.UUID(field(body, "id", 36)))
                except ValueError:
                    raise Problem(400, "Invalid message ID.") from None
                text = field(body, "text", 4000)
                mode = body.get("mode", "quick")
                if body.get("stream") is True:
                    return self.stream_chat(gateway, identity, text, mode, device=device)
                return gateway.send(identity, text, mode, device=device)
            if path in {"/records/tasks", "/tasks"}:
                return local_json(8000, "/api/v1/tasks", body=body, token=gateway.api_token(), method="POST")
            if path in {"/records/tasks/delete", "/tasks/delete"}:
                task_id = field(body, "id", 80)
                return local_json(8000, f"/api/v1/tasks/{task_id}", token=gateway.api_token(), method="DELETE")
            if path in {"/records/tasks/snooze", "/tasks/snooze"}:
                task_id = field(body, "id", 80)
                minutes = int(body.get("minutes", 5))
                return local_json(8000, f"/api/v1/tasks/{task_id}/snooze", body={"minutes": minutes}, token=gateway.api_token(), method="POST")
            if path in {"/records/notes", "/notes"}:
                return local_json(8000, "/api/v1/notes", body=body, token=gateway.api_token(), method="POST")
            if path in {"/records/notes/edit", "/notes/edit"}:
                note_id = field(body, "id", 80)
                note_body = {"title": field(body, "title", 200), "text": field(body, "text", 12000)}
                return local_json(8000, f"/api/v1/notes/{note_id}", body=note_body, token=gateway.api_token(), method="PUT")
            if path in {"/records/notes/delete", "/notes/delete"}:
                note_id = field(body, "id", 80)
                return local_json(8000, f"/api/v1/notes/{note_id}", token=gateway.api_token(), method="DELETE")
            if path == "/google/events":
                return local_json(8000, "/api/v1/google/events", body=body, token=gateway.api_token(), method="POST")
            if path == "/google/tasks":
                return local_json(8000, "/api/v1/google/tasks", body=body, token=gateway.api_token(), method="POST")
            if path in {"/google/tasks/complete", "/google/tasks/toggle"}:
                task_id = field(body, "id", 120)
                completed = bool(body.get("completed", True))
                return local_json(8000, f"/api/v1/google/tasks/{task_id}", body={"completed": completed}, token=gateway.api_token(), method="PATCH")
            if path in {"/geo/places", "/atlas/places"}:
                return local_json(8000, "/api/v1/geo/places", body=body, token=gateway.api_token(), method="POST")
            if path in {"/geo/parking", "/atlas/parking"}:
                return local_json(8000, "/api/v1/geo/parking", body=body, token=gateway.api_token(), method="POST")
            if path in {"/geo/trip-share", "/atlas/trip-share"}:
                return local_json(8000, "/api/v1/geo/trip-share", body=body, token=gateway.api_token(), method="POST")
            if path in {"/geo/queue-trip", "/atlas/queue-trip"}:
                dest = field(body, "destination", 200)
                url = field(body, "url", 2048)
                gateway.queue_trip(device, dest, url)
                return {"queued": True}
            if path in {"/people", "/people/list"}:
                return local_json(8000, "/api/v1/people", token=gateway.api_token())
            if path in {"/people/update", "/people/edit"}:
                person_id = field(body, "id", 64)
                updates = {k: v for k, v in body.items() if k in {"name", "notes", "relationship", "permission", "consent_status"}}
                return local_json(8000, f"/api/v1/people/{person_id}", body=updates, token=gateway.api_token(), method="PATCH")
            if path in {"/people/delete", "/people/remove"}:
                person_id = field(body, "id", 64)
                return local_json(8000, f"/api/v1/people/{person_id}", token=gateway.api_token(), method="DELETE")
            if path in {"/people/consent/revoke"}:
                person_id = field(body, "id", 64)
                return local_json(8000, f"/api/v1/people/{person_id}/consent/revoke", token=gateway.api_token(), method="POST")
            if path in {"/people/enroll"}:
                name = field(body, "name", 200)
                rel = body.get("relationship", "friend")
                image_b64 = body.get("image")
                if not image_b64:
                    raise Problem(400, "Image required for enrollment.")
                photo = base64.b64decode(image_b64, validate=True)
                target = f"/api/v1/people/enroll?name={urlencode({'n': name})[2:]}&relationship={rel}"
                return local_json(8000, target, photo, gateway.api_token(), timeout=30, content_type="image/jpeg")
            if path == "/actions/propose":
                return gateway.propose(device, body.get("target", "vscode"))
            if path == "/actions/confirm":
                return gateway.confirm(device, field(body, "id", 64))
            if path == "/controls/commands":
                action = field(body, "action", 100)
                params = body.get("parameters", {})
                req_id = body.get("request_id")
                return gateway.execute_control_command(device, action, params, request_id=req_id)
            if path == "/controls/schedules":
                action = field(body, "action", 64)
                mode = field(body, "mode", 32)
                minutes = body.get("minutes")
                due = body.get("due")
                recurrence = body.get("recurrence")
                return gateway.scheduler.create_schedule(action, mode, minutes, due, recurrence, owner=device)
            if path.startswith("/controls/routines/") and path.endswith("/run"):
                routine_id = path[len("/controls/routines/"):-len("/run")]
                return gateway.routines.execute_routine(routine_id, owner=device)
            if path == "/controls/routines":
                name = field(body, "name", 100)
                desc = body.get("description", "")
                actions = body.get("actions", [])
                icon = body.get("icon", "star")
                rid = body.get("id")
                return gateway.routines.save_routine(name, desc, actions, icon, routine_id=rid)
            if path == "/controls/input":
                from . import companion_windows
                etype = field(body, "type", 32)
                if etype in ("move", "click", "double_click", "scroll", "mouse_down", "mouse_up"):
                    return companion_windows.send_mouse_input(
                        etype,
                        dx=body.get("dx", 0),
                        dy=body.get("dy", 0),
                        button=body.get("button", "left"),
                        delta=body.get("delta", 0)
                    )
                elif etype in ("text", "key", "shortcut"):
                    return companion_windows.send_keyboard_input(
                        etype,
                        text=body.get("text"),
                        key=body.get("key"),
                        vk=body.get("vk")
                    )
                raise Problem(400, f"Unsupported input type: {etype}")
            if path == "/controls/clipboard":
                from . import companion_windows
                text = body.get("text", "")
                return companion_windows.write_clipboard(text)
            if path == "/controls/apps/window":
                from . import companion_windows
                hwnd = int(body.get("hwnd", 0))
                st = field(body, "state", 32)
                return companion_windows.set_window_state(hwnd, st)
            if path == "/controls/apps/terminate":
                from . import companion_windows
                pid = int(body.get("pid", 0))
                force = bool(body.get("force", False))
                return companion_windows.terminate_application(pid, force=force)
            if path == "/controls/audio/app-volume":
                from . import companion_windows
                pid = int(body.get("pid", 0))
                percent = int(body.get("percent", 50))
                muted = body.get("muted")
                return companion_windows.set_app_volume(pid, percent, muted)
            if path == "/controls/audio/mic-mute":
                from . import companion_windows
                muted = bool(body.get("muted", True))
                return companion_windows.set_microphone_mute(muted)
            if path == "/controls/displays/topology":
                from . import companion_windows
                top = field(body, "topology", 32)
                return companion_windows.set_display_topology(top)
            if path == "/controls/wol/wake":
                from . import companion_windows
                mac = field(body, "mac", 32)
                bcast = body.get("broadcast", "255.255.255.255")
                return companion_windows.send_wol_packet(mac, broadcast=bcast)
            if path == "/controls/screen/toggle":
                from . import companion_windows
                active = bool(body.get("active", True))
                return companion_windows.set_screen_sharing(active)
            if path == "/device/controls":
                return gateway.device_controls(device, body)
            if path == "/monitor/alerts/acknowledge":
                from .companion_telemetry import TelemetryEngine
                alert_id = field(body, "id", 120)
                TelemetryEngine.get_instance(gateway.directory).alerts.acknowledge(alert_id)
                return {"acknowledged": True}
            if path == "/monitor/settings":
                from .companion_telemetry import TelemetryEngine
                TelemetryEngine.get_instance(gateway.directory).alerts.update_settings(body)
                return TelemetryEngine.get_instance(gateway.directory).alerts.settings
            if path == "/unpair":
                gateway.revoke(device)
                return {}
        raise Problem(404, "Unknown operation.")

    def stream_monitor(self, engine):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        stop_event = threading.Event()

        def emit(event):
            try:
                self.wfile.write(json.dumps(event).encode() + b"\n")
                self.wfile.flush()
            except OSError:
                stop_event.set()

        try:
            engine.stream_telemetry(emit, stop_event, interval=1.0)
        except OSError:
            pass
        return None

    def stream_chat(self, gateway, identity, text, mode, device="companion"):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def emit(event):
            self.wfile.write(json.dumps(event).encode() + b"\n")
            self.wfile.flush()

        try:
            result = gateway.send(identity, text, mode, emit, device=device)
            emit({"history": result})
        except OSError:
            return None
        except Problem as error:
            emit({"error": error.message})
        except Exception:
            emit({"error": "Companion could not finish the reply."})
        return None

    def handle_api(self):
        try:
            status, data = 200, self.route()
            if data is None:
                return
        except Problem as error:
            status, data = error.status, {"message": error.message}
        except Exception as error:
            print(f"Companion request failed: {type(error).__name__}", flush=True)
            status, data = 500, {"message": "Companion could not complete the request."}
        payload = json.dumps(data).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            pass


def field(body, key, limit):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Problem(400, f"Invalid {key}.")
    return value.strip()


def certificate(directory):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    cert, key = directory / "companion.pem", directory / "companion-key.pem"
    if not cert.exists() or not key.exists():
        private = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Oracle Companion")])
        now = dt.datetime.now(dt.timezone.utc)
        signed = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                  .public_key(private.public_key()).serial_number(x509.random_serial_number())
                  .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=365))
                  .sign(private, hashes.SHA256()))
        key.write_bytes(private.private_bytes(serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        cert.write_bytes(signed.public_bytes(serialization.Encoding.PEM))
    return cert, key
