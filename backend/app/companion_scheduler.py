"""Persistent scheduler for Oracle Companion power actions and routines."""
import datetime as dt
import json
import logging
import sqlite3
import threading
import time
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)


class CompanionScheduler:
    def __init__(self, db_factory, execute_action_fn):
        self.db_factory = db_factory
        self.execute_action = execute_action_fn
        self.lock = threading.Lock()
        self.timers = {} # schedule_id -> threading.Timer
        self._init_db()
        self.restore()

    def _init_db(self):
        with self.db_factory() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS scheduled_actions (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    due INTEGER NOT NULL,
                    recurrence TEXT,
                    owner TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    last_result TEXT
                );
                CREATE TABLE IF NOT EXISTS schedule_history (
                    id TEXT PRIMARY KEY,
                    schedule_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    executed_at INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT
                );
            """)

    def restore(self):
        """Restore active schedules on startup; mark missed ones."""
        with self.lock:
            # Cancel any existing in-memory timers
            for timer in self.timers.values():
                timer.cancel()
            self.timers.clear()

            now = int(time.time())
            with self.db_factory() as db:
                rows = db.execute("SELECT * FROM scheduled_actions WHERE status='pending'").fetchall()
                for row in rows:
                    sched_id = row["id"]
                    due = row["due"]
                    recurrence = row["recurrence"]
                    owner = row["owner"]
                    action = row["action"]

                    if due <= now:
                        if recurrence:
                            # Calculate next recurrence
                            next_due = self._compute_next_recurrence(due, recurrence)
                            db.execute("UPDATE scheduled_actions SET due=? WHERE id=?", (next_due, sched_id))
                            self._arm_timer(sched_id, action, next_due, recurrence, owner)
                        else:
                            db.execute("UPDATE scheduled_actions SET status='missed', last_result='Missed while Central was offline' WHERE id=?", (sched_id,))
                            self._record_history(sched_id, action, now, "missed", "Missed while Central was offline")
                    else:
                        self._arm_timer(sched_id, action, due, recurrence, owner)

    def _compute_next_recurrence(self, last_due, recurrence):
        now = int(time.time())
        t = last_due
        rec = recurrence.lower()
        if rec == "daily":
            while t <= now:
                t += 86400
        elif rec == "weekdays":
            while t <= now or dt.datetime.fromtimestamp(t).weekday() >= 5:
                t += 86400
        elif rec == "weekly":
            while t <= now:
                t += 7 * 86400
        else:
            t = now + 86400
        return t

    def _arm_timer(self, sched_id, action, due, recurrence, owner):
        delay = max(0, due - int(time.time()))
        timer = threading.Timer(delay, self._fire_schedule, args=(sched_id, action, due, recurrence, owner))
        timer.daemon = True
        self.timers[sched_id] = timer
        timer.start()

    def _fire_schedule(self, sched_id, action, due, recurrence, owner):
        with self.lock:
            self.timers.pop(sched_id, None)

        now = int(time.time())
        logger.info(f"Firing scheduled action {action} (ID {sched_id}) for device {owner}")

        status = "completed"
        msg = "Executed successfully."
        try:
            res = self.execute_action(action, owner)
            if isinstance(res, dict) and "message" in res:
                msg = res["message"]
        except Exception as e:
            status = "failed"
            msg = str(e)
            logger.error(f"Scheduled action {action} failed: {e}")

        self._record_history(sched_id, action, now, status, msg)

        with self.db_factory() as db:
            if recurrence:
                next_due = self._compute_next_recurrence(due, recurrence)
                db.execute("UPDATE scheduled_actions SET due=?, last_result=? WHERE id=?", (next_due, msg, sched_id))
                with self.lock:
                    self._arm_timer(sched_id, action, next_due, recurrence, owner)
            else:
                db.execute("UPDATE scheduled_actions SET status=?, last_result=? WHERE id=?", (status, msg, sched_id))

    def _record_history(self, sched_id, action, executed_at, status, message):
        with self.db_factory() as db:
            db.execute(
                "INSERT INTO schedule_history (id, schedule_id, action, executed_at, status, message) VALUES (?,?,?,?,?,?)",
                (str(uuid.uuid4()), sched_id, action, executed_at, status, message)
            )

    def create_schedule(self, action: str, mode: str, minutes: int = None, due_time: int = None,
                        recurrence: str = None, owner: str = "local"):
        now = int(time.time())
        if mode == "countdown":
            mins = max(1, int(minutes or 15))
            due = now + (mins * 60)
        elif mode == "exact_time":
            if not due_time or due_time <= now:
                raise ValueError("Due time must be in the future.")
            due = int(due_time)
        elif mode == "recurring":
            if not recurrence:
                raise ValueError("Recurrence rule (e.g. daily, weekdays) required for recurring schedule.")
            due = due_time if (due_time and due_time > now) else (now + 86400)
        else:
            raise ValueError(f"Unknown scheduling mode: {mode}")

        sched_id = str(uuid.uuid4())
        with self.db_factory() as db:
            db.execute(
                "INSERT INTO scheduled_actions (id, action, mode, due, recurrence, owner, created_at, status, last_result) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (sched_id, action, mode, due, recurrence, owner, now, "pending", None)
            )

        with self.lock:
            self._arm_timer(sched_id, action, due, recurrence, owner)

        return {
            "id": sched_id,
            "action": action,
            "mode": mode,
            "due": due,
            "recurrence": recurrence,
            "owner": owner,
            "status": "pending"
        }

    def cancel_schedule(self, sched_id: str):
        with self.lock:
            timer = self.timers.pop(sched_id, None)
            if timer:
                timer.cancel()

        with self.db_factory() as db:
            changed = db.execute("UPDATE scheduled_actions SET status='cancelled' WHERE id=?", (sched_id,)).rowcount
            if not changed:
                raise ValueError("Schedule not found or already cancelled.")

        self._record_history(sched_id, "unknown", int(time.time()), "cancelled", "Cancelled by user.")
        return {"status": "ok", "message": "Schedule cancelled."}

    def list_schedules(self, include_history=False):
        with self.db_factory() as db:
            active = db.execute("SELECT * FROM scheduled_actions WHERE status='pending' ORDER BY due ASC").fetchall()
            active_list = [dict(r) for r in active]
            history_list = []
            if include_history:
                hist = db.execute("SELECT * FROM schedule_history ORDER BY executed_at DESC LIMIT 50").fetchall()
                history_list = [dict(h) for h in hist]
            return {"active": active_list, "history": history_list}

    def get_next_scheduled_action(self):
        with self.db_factory() as db:
            row = db.execute("SELECT * FROM scheduled_actions WHERE status='pending' ORDER BY due ASC LIMIT 1").fetchone()
            return dict(row) if row else None
