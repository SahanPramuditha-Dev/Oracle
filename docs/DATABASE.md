# ORACLE database operations

Phase 3.1 uses PostgreSQL through SQLAlchemy 2 Core, with Alembic schema revisions. The frontend continues to call the existing authenticated FastAPI endpoints; it has no database credentials or direct database access. Notes, reminders, timers, due reconciliation, quotas and record validation are backend responsibilities.

## This machine

The installed PostgreSQL 18 binaries run an ORACLE-only cluster in ignored `data/postgresql`, listening on `127.0.0.1:55432`. Existing PostgreSQL services and databases are left unchanged. The database is `oracle`, owned by the application role `oracle_app`, which has no superuser, role-creation or database-creation privileges. SCRAM password authentication is enabled. Setup credentials are in ignored `data/dev/postgres-admin.json`; the application URL is in ignored `backend/.env` as `ORACLE_DATABASE_URL`. Never copy these values into the frontend or commit them.

Use `scripts/start-dev.ps1` normally: it starts this cluster if necessary before launching the backend. The database stays running when the frontend closes. This is a local development instance, not a hosted service or multi-user deployment.

## Reproduce setup

Run from the project root with the installed PostgreSQL binaries available:

```powershell
.\backend\.venv\Scripts\python.exe scripts\manage_postgres.py --provision
# Stop the gateway before copying records, so the source cannot change during cutover.
.\backend\.venv\Scripts\python.exe scripts\migrate_records.py --activate
.\scripts\start-dev.ps1
```

`ORACLE_PG_BIN` can point to another installed PostgreSQL binary folder. Provisioning is repeatable and does not reset existing credentials. The migration keeps the SQLite source and creates a consistent backup in `data/backups`, imports within one transaction, compares every source row against the destination and activates the URL only after verification. Matching repeated imports do not duplicate records. Conflicting destination edits stop and roll back the import rather than overwriting data. The original application store contained zero notes and zero tasks at cutover; nonempty transfers and conflict rollback are covered by real PostgreSQL integration tests.

## Schema and connections

The initial Alembic revision creates the record tables, indexes and quota-lock rows. Revision `0002_image_memory` adds approved image memories, storing the normalized JPEG and metadata in the same PostgreSQL row. Image memories are included in normal dumps; deletion removes active records, not older backup copies. The gateway checks/upgrades revisions at startup; use a single gateway process for development. To apply explicitly, run `.venv\Scripts\python.exe -m alembic upgrade head` from `backend`. Do not stamp revisions manually to hide schema differences. Destructive downgrades are disabled.

SQLAlchemy provides bounded connection pooling, stale-connection checks and transactional commit/rollback. PostgreSQL quota checks lock a dedicated row so concurrent requests cannot exceed record limits. Each request gets its own connection; connections return to the pool and the pool is disposed at shutdown. Configured PostgreSQL connection failures never silently switch storage back to SQLite. SQLite remains supported for compatibility and isolated unit tests.

## Backup and recovery

```powershell
.\backend\.venv\Scripts\python.exe scripts\backup_records.py
```

This creates a custom-format PostgreSQL dump without putting its connection URL in process arguments. Backups contain personal records and stay ignored. A dump file is not a verified recovery until restored and checked in a separate empty database. Do not copy a running PostgreSQL data directory as a substitute for `pg_dump`.

For rollback, stop the gateway and preserve PostgreSQL with a dump before changing `ORACLE_DATABASE_URL`. The retained SQLite file is the cutover snapshot, not a synchronized replica: switching to it later will not include subsequent PostgreSQL changes. Restore or transfer those records deliberately before resuming writes.

## Verification

Set `ORACLE_TEST_DATABASE_URL` locally to a PostgreSQL URL and run backend pytest. PostgreSQL tests create uniquely named disposable schemas and remove only those schemas; application rows are never cleared. Coverage includes API persistence, literal search, overdue tasks, concurrent quotas, repeatable migrations/imports and transactional conflict rollback. Browser record tests use the active backend. Preferences and page-local conversation history remain frontend concerns; there are no background alarms while the interface is closed.

References: [SQLAlchemy engines](https://docs.sqlalchemy.org/en/20/core/engines.html), [Alembic migrations](https://alembic.sqlalchemy.org/en/latest/tutorial.html).
