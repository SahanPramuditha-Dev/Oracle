"""Durable Windows PC Control Scheduler for Oracle Central and Companion.

Supports:
- One-shot countdown schedules (e.g., in 15 minutes, 1 hour).
- Exact date/time schedules (UTC timestamp).
- Recurring schedules (daily, weekdays, specific days of week).
- Actions: shutdown, restart, sleep, hibernate, lock, display_off, cancel_stay_awake.
- Independent background execution thread on PC surviving phone disconnection.
- SQLite persistence in companion.db table control_schedules.
- Execution history recorded in control_activity.
"""

import datetime as dt
import json
import logging
import sqlite3
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class ControlScheduler:
    def __init__(self, db_factory: Callable[[], sqlite3.Connection], action_dispatcher: Callable[[str, Dict[str, Any]], Dict[str, Any]]):
        self.db_factory = db_factory
        self.action_dispatcher = action_dispatcher
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self.db_factory() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS control_schedules (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    parameters TEXT NOT NULL,
                    creator TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    execute_at INTEGER NOT NULL,
                    recurrence TEXT,
                    timezone TEXT,
                    status TEXT NOT NULL, -- 'pending', 'executing', 'completed', 'cancelled', 'failed'
                    last_result TEXT
                );
                CREATE TABLE IF NOT EXISTS control_activity (
                    id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_schedules_due ON control_schedules(execute_at, status);
            """)

    def start(self):
        """Starts the scheduler background loop."""
        with self._lock:
            if self._worker_thread and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(target=self._run_loop, name="ControlSchedulerDaemon", daemon=True)
            self._worker_thread.start()
            logger.info("ControlScheduler daemon started.")

    def stop(self):
        """Stops the scheduler loop."""
        self._stop_event.set()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)

    def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                self._check_and_execute_due_jobs()
            except Exception as e:
                logger.error("Error in scheduler execution loop: %s", e)
            self._stop_event.wait(timeout=2.0)

    def _check_and_execute_due_jobs(self):
        now = int(time.time())
        due_jobs = []
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute(
                "SELECT * FROM control_schedules WHERE status='pending' AND execute_at <= ? ORDER BY execute_at ASC",
                (now,)
            ).fetchall()
            for r in rows:
                due_jobs.append(dict(r))

        for job in due_jobs:
            self._execute_job(job)

    def _execute_job(self, job: Dict[str, Any]):
        job_id = job["id"]
        action = job["action"]
        creator = job["creator"]
        recurrence = job.get("recurrence")
        params = {}
        try:
            params = json.loads(job["parameters"])
        except Exception:
            pass

        # Mark as executing atomically
        with self.db_factory() as db:
            updated = db.execute(
                "UPDATE control_schedules SET status='executing' WHERE id=? AND status='pending'",
                (job_id,)
            ).rowcount
            if not updated:
                return

        logger.info("Executing scheduled action '%s' (job ID: %s)", action, job_id)
        outcome_status = "completed"
        outcome_msg = ""
        try:
            res = self.action_dispatcher(action, params)
            outcome_msg = res.get("message", f"Scheduled action {action} completed.")
        except Exception as e:
            outcome_status = "failed"
            outcome_msg = str(e)
            logger.error("Scheduled action '%s' failed: %s", action, e)

        # Handle recurrence or complete
        with self.db_factory() as db:
            next_time = None
            if recurrence and outcome_status == "completed":
                next_time = self._compute_next_run(job["execute_at"], recurrence)

            if next_time:
                db.execute(
                    "UPDATE control_schedules SET status='pending', execute_at=?, last_result=? WHERE id=?",
                    (next_time, outcome_msg, job_id)
                )
            else:
                db.execute(
                    "UPDATE control_schedules SET status=?, last_result=? WHERE id=?",
                    (outcome_status, outcome_msg, job_id)
                )

            # Record event in activity
            db.execute(
                "INSERT INTO control_activity (id, device_id, action, status, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), creator, f"schedule.{action}", outcome_status, outcome_msg, int(time.time()))
            )

    def _compute_next_run(self, current_execute_at: int, recurrence: str) -> Optional[int]:
        """Calculates next execution timestamp based on recurrence rule."""
        rec = recurrence.lower().strip()
        dt_current = dt.datetime.fromtimestamp(current_execute_at, dt.timezone.utc)
        if rec == "daily":
            return int((dt_current + dt.timedelta(days=1)).timestamp())
        elif rec == "weekdays":
            next_day = dt_current + dt.timedelta(days=1)
            while next_day.weekday() >= 5:  # 5=Saturday, 6=Sunday
                next_day += dt.timedelta(days=1)
            return int(next_day.timestamp())
        elif rec == "weekly":
            return int((dt_current + dt.timedelta(weeks=1)).timestamp())
        return None

    def create_schedule(
        self,
        action: str,
        parameters: Dict[str, Any],
        creator: str,
        delay_seconds: Optional[int] = None,
        execute_at: Optional[int] = None,
        recurrence: Optional[str] = None,
        timezone: str = "UTC"
    ) -> Dict[str, Any]:
        """Creates a new durable scheduled power action."""
        now = int(time.time())
        if delay_seconds is not None:
            if delay_seconds < 1:
                raise ValueError("Delay must be at least 1 second.")
            target_time = now + delay_seconds
        elif execute_at is not None:
            if execute_at <= now:
                raise ValueError("Scheduled time must be in the future.")
            target_time = execute_at
        else:
            raise ValueError("Either delay_seconds or execute_at must be provided.")

        allowed_actions = {
            "power.shutdown", "power.restart", "power.sleep", "power.hibernate",
            "power.lock", "power.turn_off_display", "power.stay_awake", "power.cancel_stay_awake"
        }
        if action not in allowed_actions:
            raise ValueError(f"Action '{action}' cannot be scheduled. Allowed: {allowed_actions}")

        schedule_id = str(uuid.uuid4())
        with self.db_factory() as db:
            db.execute("""
                INSERT INTO control_schedules (id, action, parameters, creator, created_at, execute_at, recurrence, timezone, status, last_result)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '')
            """, (
                schedule_id,
                action,
                json.dumps(parameters or {}),
                creator,
                now,
                target_time,
                recurrence,
                timezone
            ))

        return self.get_schedule(schedule_id)

    def get_schedule(self, schedule_id: str) -> Optional[Dict[str, Any]]:
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM control_schedules WHERE id=?", (schedule_id,)).fetchone()
            if not row:
                return None
            return self._format_schedule(dict(row))

    def list_schedules(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            if status:
                rows = db.execute(
                    "SELECT * FROM control_schedules WHERE status=? ORDER BY execute_at ASC", (status,)
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM control_schedules ORDER BY execute_at ASC"
                ).fetchall()
            return [self._format_schedule(dict(r)) for r in rows]

    def cancel_schedule(self, schedule_id: str, caller_device: Optional[str] = None) -> Dict[str, Any]:
        with self.db_factory() as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM control_schedules WHERE id=?", (schedule_id,)).fetchone()
            if not row:
                raise ValueError("Schedule not found.")
            if row["status"] != "pending":
                raise ValueError(f"Cannot cancel schedule with status '{row['status']}'.")

            db.execute("UPDATE control_schedules SET status='cancelled' WHERE id=?", (schedule_id,))
            db.execute(
                "INSERT INTO control_activity (id, device_id, action, status, message, timestamp) VALUES (?, ?, ?, 'cancelled', 'Schedule cancelled.', ?)",
                (str(uuid.uuid4()), caller_device or row["creator"], f"schedule.cancel", int(time.time()))
            )
            return {"id": schedule_id, "status": "cancelled", "message": "Scheduled action cancelled."}

    def modify_schedule(self, schedule_id: str, new_execute_at: int) -> Dict[str, Any]:
        now = int(time.time())
        if new_execute_at <= now:
            raise ValueError("New execution time must be in the future.")
        with self.db_factory() as db:
            updated = db.execute(
                "UPDATE control_schedules SET execute_at=? WHERE id=? AND status='pending'",
                (new_execute_at, schedule_id)
            ).rowcount
            if not updated:
                raise ValueError("Schedule not found or not in pending state.")
        return self.get_schedule(schedule_id)

    def _format_schedule(self, row: Dict[str, Any]) -> Dict[str, Any]:
        now = int(time.time())
        due = row["execute_at"]
        remaining = max(0, due - now) if row["status"] == "pending" else 0
        params = {}
        try:
            params = json.loads(row["parameters"])
        except Exception:
            pass
        return {
            "id": row["id"],
            "action": row["action"],
            "parameters": params,
            "creator": row["creator"],
            "created_at": row["created_at"],
            "execute_at": due,
            "remaining_seconds": remaining,
            "recurrence": row.get("recurrence"),
            "timezone": row.get("timezone", "UTC"),
            "status": row["status"],
            "last_result": row.get("last_result", "")
        }
