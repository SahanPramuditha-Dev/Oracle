"""Automation Routines Engine for Oracle Central and Companion.

Combines allowlisted PC controls into multi-step automations.
Supports:
- Predefined routines (Study Mode, Night Mode, Presentation Mode, Gaming Mode).
- User-created custom routines.
- Step-by-step execution with delays and failure policy ('abort' vs 'continue').
- Persistence in companion.db table control_routines.
- Execution logging into control_activity.
"""

import json
import logging
import sqlite3
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_ROUTINES = [
    {
        "id": "routine-study",
        "name": "Study Mode",
        "description": "Sets volume to 25%, mutes microphone, launches VS Code, and keeps PC awake for 1 hour.",
        "icon": "book-open",
        "failure_policy": "continue",
        "steps": [
            {"action": "audio.set_volume", "parameters": {"percent": 25}},
            {"action": "audio.set_mic_mute", "parameters": {"muted": True}},
            {"action": "power.stay_awake", "parameters": {"duration_seconds": 3600}},
            {"action": "apps.launch", "parameters": {"app_id": "vscode"}}
        ]
    },
    {
        "id": "routine-night",
        "name": "Night Mode",
        "description": "Lowers volume to 10%, turns off display, and cancels stay-awake.",
        "icon": "moon",
        "failure_policy": "continue",
        "steps": [
            {"action": "audio.set_volume", "parameters": {"percent": 10}},
            {"action": "power.cancel_stay_awake", "parameters": {}},
            {"action": "display.turn_off", "parameters": {}}
        ]
    },
    {
        "id": "routine-presentation",
        "name": "Presentation Mode",
        "description": "Sets volume to 50%, keeps PC awake, and shows desktop.",
        "icon": "monitor",
        "failure_policy": "continue",
        "steps": [
            {"action": "audio.set_volume", "parameters": {"percent": 50}},
            {"action": "power.stay_awake", "parameters": {"duration_seconds": 7200}},
            {"action": "input.key", "parameters": {"key": "show_desktop"}}
        ]
    },
    {
        "id": "routine-gaming",
        "name": "Gaming Mode",
        "description": "Sets volume to 75%, unmutes microphone, and cancels stay-awake.",
        "icon": "gamepad",
        "failure_policy": "continue",
        "steps": [
            {"action": "audio.set_volume", "parameters": {"percent": 75}},
            {"action": "audio.set_mic_mute", "parameters": {"muted": False}},
            {"action": "power.cancel_stay_awake", "parameters": {}}
        ]
    }
]


class RoutineEngine:
    def __init__(self, db_factory: Callable[[], sqlite3.Connection], action_dispatcher: Callable[[str, Dict[str, Any]], Dict[str, Any]]):
        self.db_factory = db_factory
        self.action_dispatcher = action_dispatcher
        self._running_routine: Optional[Dict[str, Any]] = None
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self.db_factory() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS control_routines (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    icon TEXT,
                    failure_policy TEXT NOT NULL DEFAULT 'continue', -- 'abort' or 'continue'
                    steps TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    last_run_at INTEGER,
                    last_status TEXT
                );
                CREATE TABLE IF NOT EXISTS control_activity (
                    id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
            """)
            # Seed default routines if empty
            count = db.execute("SELECT COUNT(*) FROM control_routines").fetchone()[0]
            if count == 0:
                now = int(time.time())
                for r in DEFAULT_ROUTINES:
                    db.execute("""
                        INSERT INTO control_routines (id, name, description, icon, failure_policy, steps, created_at, last_run_at, last_status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'never_run')
                    """, (
                        r["id"], r["name"], r["description"], r["icon"],
                        r["failure_policy"], json.dumps(r["steps"]), now
                    ))

    def list_routines(self) -> List[Dict[str, Any]]:
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT * FROM control_routines ORDER BY created_at ASC").fetchall()
            routines = []
            for r in rows:
                steps = []
                try:
                    steps = json.loads(r["steps"])
                except Exception:
                    pass
                routines.append({
                    "id": r["id"],
                    "name": r["name"],
                    "description": r["description"] or "",
                    "icon": r["icon"] or "settings",
                    "failure_policy": r["failure_policy"],
                    "steps": steps,
                    "created_at": r["created_at"],
                    "last_run_at": r["last_run_at"],
                    "last_status": r["last_status"]
                })
            return routines

    def get_routine(self, routine_id: str) -> Optional[Dict[str, Any]]:
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM control_routines WHERE id=?", (routine_id,)).fetchone()
            if not row:
                return None
            steps = []
            try:
                steps = json.loads(row["steps"])
            except Exception:
                pass
            return {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"] or "",
                "icon": row["icon"] or "settings",
                "failure_policy": row["failure_policy"],
                "steps": steps,
                "created_at": row["created_at"],
                "last_run_at": row["last_run_at"],
                "last_status": row["last_status"]
            }

    def save_routine(
        self,
        name: str,
        steps: List[Dict[str, Any]],
        description: str = "",
        icon: str = "settings",
        failure_policy: str = "continue",
        routine_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Creates or updates a routine."""
        if not name.strip():
            raise ValueError("Routine name cannot be empty.")
        if not steps or not isinstance(steps, list):
            raise ValueError("Routine must contain at least one step.")

        # Validate step actions
        for i, s in enumerate(steps):
            if "action" not in s or not isinstance(s["action"], str):
                raise ValueError(f"Step {i + 1} is missing a valid action.")

        identity = routine_id or f"routine-{uuid.uuid4().hex[:8]}"
        now = int(time.time())
        with self.db_factory() as db:
            db.execute("""
                INSERT INTO control_routines (id, name, description, icon, failure_policy, steps, created_at, last_run_at, last_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'never_run')
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, description=excluded.description, icon=excluded.icon,
                    failure_policy=excluded.failure_policy, steps=excluded.steps
            """, (
                identity, name.strip(), description.strip(), icon.strip(),
                failure_policy, json.dumps(steps), now
            ))
        return self.get_routine(identity)

    def delete_routine(self, routine_id: str) -> Dict[str, Any]:
        with self.db_factory() as db:
            deleted = db.execute("DELETE FROM control_routines WHERE id=?", (routine_id,)).rowcount
            if not deleted:
                raise ValueError("Routine not found.")
            return {"status": "completed", "id": routine_id, "message": "Routine deleted."}

    def run_routine(self, routine_id: str, caller_device: str = "companion") -> Dict[str, Any]:
        """Runs a routine asynchronously and tracks progress."""
        routine = self.get_routine(routine_id)
        if not routine:
            raise ValueError(f"Routine '{routine_id}' not found.")

        with self._lock:
            if self._running_routine:
                raise RuntimeError(f"Routine '{self._running_routine['name']}' is currently executing.")
            self._running_routine = {
                "id": routine_id,
                "name": routine["name"],
                "started_at": int(time.time()),
                "total_steps": len(routine["steps"]),
                "current_step": 0
            }

        def _execute():
            step_results = []
            overall_success = True
            try:
                for idx, step in enumerate(routine["steps"]):
                    with self._lock:
                        if self._running_routine:
                            self._running_routine["current_step"] = idx + 1

                    action = step["action"]
                    params = step.get("parameters", {})
                    delay = step.get("delay_seconds", 0)
                    if delay > 0:
                        time.sleep(delay)

                    try:
                        res = self.action_dispatcher(action, params)
                        step_results.append({"step": idx + 1, "action": action, "status": "completed", "result": res})
                    except Exception as e:
                        logger.error("Step %d (%s) failed: %s", idx + 1, action, e)
                        step_results.append({"step": idx + 1, "action": action, "status": "failed", "error": str(e)})
                        if routine["failure_policy"] == "abort":
                            overall_success = False
                            break

                final_status = "completed" if overall_success else "partial_failure"
                now = int(time.time())
                with self.db_factory() as db:
                    db.execute(
                        "UPDATE control_routines SET last_run_at=?, last_status=? WHERE id=?",
                        (now, final_status, routine_id)
                    )
                    db.execute(
                        "INSERT INTO control_activity (id, device_id, action, status, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), caller_device, f"routine.{routine['name']}", final_status,
                         f"Executed {len(step_results)} of {len(routine['steps'])} steps.", now)
                    )
            finally:
                with self._lock:
                    self._running_routine = None

        thread = threading.Thread(target=_execute, name=f"RoutineExec-{routine_id}", daemon=True)
        thread.start()

        return {
            "status": "accepted",
            "routine_id": routine_id,
            "name": routine["name"],
            "total_steps": len(routine["steps"]),
            "message": f"Routine '{routine['name']}' started."
        }

    def get_active_routine(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return dict(self._running_routine) if self._running_routine else None
