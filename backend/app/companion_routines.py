"""Automations and Routines engine for Oracle Companion."""
import json
import logging
import sqlite3
import threading
import time
import uuid

logger = logging.getLogger(__name__)

DEFAULT_ROUTINES = [
    {
        "id": "builtin_study_mode",
        "name": "Study Mode",
        "description": "Sets volume to 25%, enables stay-awake for 60 min, and opens your study environment.",
        "icon": "book",
        "actions": [
            {"action": "audio.set_volume", "params": {"percent": 25}},
            {"action": "audio.set_mute", "params": {"muted": False}},
            {"action": "power.stay_awake", "params": {"minutes": 60}},
            {"action": "app.launch", "params": {"app_id": "code"}}
        ]
    },
    {
        "id": "builtin_night_mode",
        "name": "Night Mode",
        "description": "Sets volume to 10% and turns off the display to save power.",
        "icon": "moon",
        "actions": [
            {"action": "audio.set_volume", "params": {"percent": 10}},
            {"action": "power.display_off", "params": {}}
        ]
    },
    {
        "id": "builtin_presentation_mode",
        "name": "Presentation Mode",
        "description": "Keeps PC awake for 90 minutes and focuses active presentation window.",
        "icon": "presentation",
        "actions": [
            {"action": "power.stay_awake", "params": {"minutes": 90}},
            {"action": "input.shortcut", "params": {"key": "presentation_start"}}
        ]
    },
    {
        "id": "builtin_gaming_mode",
        "name": "Gaming Mode",
        "description": "Sets master volume to 65% and keeps the system fully active.",
        "icon": "gamepad",
        "actions": [
            {"action": "audio.set_volume", "params": {"percent": 65}},
            {"action": "audio.set_mute", "params": {"muted": False}},
            {"action": "power.stay_awake", "params": {"minutes": 120}}
        ]
    }
]


class RoutineEngine:
    def __init__(self, db_factory, dispatch_command_fn):
        self.db_factory = db_factory
        self.dispatch_command = dispatch_command_fn
        self._init_db()

    def _init_db(self):
        with self.db_factory() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS routines (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    icon TEXT,
                    actions_json TEXT NOT NULL,
                    enabled INTEGER DEFAULT 1,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS routine_history (
                    id TEXT PRIMARY KEY,
                    routine_id TEXT NOT NULL,
                    routine_name TEXT NOT NULL,
                    executed_at INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    log_json TEXT NOT NULL
                );
            """)
            # Seed default routines if empty
            count = db.execute("SELECT COUNT(*) AS c FROM routines").fetchone()["c"]
            if count == 0:
                now = int(time.time())
                for r in DEFAULT_ROUTINES:
                    db.execute(
                        "INSERT INTO routines (id, name, description, icon, actions_json, enabled, created_at) VALUES (?,?,?,?,?,?,?)",
                        (r["id"], r["name"], r["description"], r.get("icon", "star"), json.dumps(r["actions"]), 1, now)
                    )

    def list_routines(self):
        with self.db_factory() as db:
            rows = db.execute("SELECT * FROM routines ORDER BY created_at ASC").fetchall()
            routines = []
            for r in rows:
                routines.append({
                    "id": r["id"],
                    "name": r["name"],
                    "description": r["description"],
                    "icon": r["icon"],
                    "actions": json.loads(r["actions_json"]),
                    "enabled": bool(r["enabled"])
                })
            return routines

    def save_routine(self, name: str, description: str, actions: list, icon: str = "star", routine_id: str = None):
        rid = routine_id or str(uuid.uuid4())
        now = int(time.time())
        with self.db_factory() as db:
            db.execute(
                "INSERT INTO routines (id, name, description, icon, actions_json, enabled, created_at) "
                "VALUES (?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET "
                "name=excluded.name, description=excluded.description, icon=excluded.icon, actions_json=excluded.actions_json",
                (rid, name, description, icon, json.dumps(actions), now)
            )
        return {"id": rid, "name": name, "actions": actions}

    def delete_routine(self, routine_id: str):
        with self.db_factory() as db:
            db.execute("DELETE FROM routines WHERE id=?", (routine_id,))
        return {"status": "ok", "message": "Routine deleted."}

    def execute_routine(self, routine_id: str, owner: str = "local"):
        with self.db_factory() as db:
            row = db.execute("SELECT * FROM routines WHERE id=?", (routine_id,)).fetchone()
            if not row:
                raise ValueError(f"Routine {routine_id} not found.")

        name = row["name"]
        actions = json.loads(row["actions_json"])
        logs = []
        overall_status = "completed"

        for step_idx, step in enumerate(actions):
            act_name = step.get("action")
            params = step.get("params", {})
            delay_sec = step.get("delay", 0)
            if delay_sec > 0:
                time.sleep(min(delay_sec, 10))

            step_res = {"step": step_idx + 1, "action": act_name, "timestamp": int(time.time())}
            try:
                res = self.dispatch_command(act_name, params, owner)
                step_res["status"] = "ok"
                step_res["result"] = res
            except Exception as e:
                step_res["status"] = "error"
                step_res["error"] = str(e)
                overall_status = "partial_failure"
                logger.error(f"Routine {name} step {step_idx+1} ({act_name}) failed: {e}")
            logs.append(step_res)

        now = int(time.time())
        with self.db_factory() as db:
            db.execute(
                "INSERT INTO routine_history (id, routine_id, routine_name, executed_at, status, log_json) VALUES (?,?,?,?,?,?)",
                (str(uuid.uuid4()), routine_id, name, now, overall_status, json.dumps(logs))
            )

        return {
            "routine_id": routine_id,
            "name": name,
            "status": overall_status,
            "executed_at": now,
            "steps": logs
        }

    def get_history(self, limit=20):
        with self.db_factory() as db:
            rows = db.execute("SELECT * FROM routine_history ORDER BY executed_at DESC LIMIT ?", (limit,)).fetchall()
            history = []
            for r in rows:
                history.append({
                    "id": r["id"],
                    "routine_id": r["routine_id"],
                    "routine_name": r["routine_name"],
                    "executed_at": r["executed_at"],
                    "status": r["status"],
                    "logs": json.loads(r["log_json"])
                })
            return history
