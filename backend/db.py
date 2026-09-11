"""
Storage layer for the PostureGuard backend.

Two backends, one interface:

* **Postgres** when ``DATABASE_URL`` is set. Required on any serverless host
  (Vercel, Lambda) because the function filesystem is ephemeral and read-only
  outside ``/tmp`` - a SQLite file written there is discarded when the instance
  is recycled, so the data would be accepted and then silently lost.
* **SQLite** otherwise, which keeps local development and the test suite free
  of any external dependency.

Queries are written once using SQLite's ``?`` placeholder and translated for
psycopg, so callers never branch on the dialect.
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Sequence

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

DB_PATH = Path(os.environ.get("POSTUREGUARD_DB", Path(__file__).parent / "postureguard.db"))

# Millisecond epoch timestamps exceed a 32-bit int, so every time column has to
# be BIGINT on Postgres. SQLite's INTEGER is already 64-bit.
_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    participant_id      TEXT NOT NULL,
    start_time          INTEGER NOT NULL,
    end_time            INTEGER,
    duration_seconds    INTEGER NOT NULL DEFAULT 0,
    sitting_seconds     INTEGER NOT NULL DEFAULT 0,
    mode                TEXT NOT NULL DEFAULT 'study',
    avg_deviation_pct   REAL NOT NULL DEFAULT 0,
    posture_alerts      INTEGER NOT NULL DEFAULT 0,
    breaks_prompted     INTEGER NOT NULL DEFAULT 0,
    breaks_taken        INTEGER NOT NULL DEFAULT 0,
    breaks_snoozed      INTEGER NOT NULL DEFAULT 0,
    received_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL,
    type             TEXT NOT NULL,
    timestamp        INTEGER NOT NULL,
    deviation_pct    REAL,
    duration_seconds INTEGER,
    UNIQUE (session_id, type, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
"""

_POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    participant_id      TEXT NOT NULL,
    start_time          BIGINT NOT NULL,
    end_time            BIGINT,
    duration_seconds    BIGINT NOT NULL DEFAULT 0,
    sitting_seconds     BIGINT NOT NULL DEFAULT 0,
    mode                TEXT NOT NULL DEFAULT 'study',
    avg_deviation_pct   DOUBLE PRECISION NOT NULL DEFAULT 0,
    posture_alerts      INTEGER NOT NULL DEFAULT 0,
    breaks_prompted     INTEGER NOT NULL DEFAULT 0,
    breaks_taken        INTEGER NOT NULL DEFAULT 0,
    breaks_snoozed      INTEGER NOT NULL DEFAULT 0,
    received_at         BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id               BIGSERIAL PRIMARY KEY,
    session_id       TEXT NOT NULL,
    type             TEXT NOT NULL,
    timestamp        BIGINT NOT NULL,
    deviation_pct    DOUBLE PRECISION,
    duration_seconds BIGINT,
    UNIQUE (session_id, type, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
"""


def _translate(sql: str) -> str:
    """Rewrite SQLite-flavoured SQL for psycopg."""
    if not IS_POSTGRES:
        return sql
    sql = sql.replace("INSERT OR IGNORE INTO", "INSERT INTO")
    # Placeholders are positional in both dialects, only the marker differs.
    # Question marks never appear inside our string literals.
    sql = re.sub(r"\?", "%s", sql)
    return sql


def _needs_do_nothing(sql: str) -> bool:
    return IS_POSTGRES and "INSERT OR IGNORE" in sql


class Connection:
    """Minimal wrapper giving both drivers the same calling convention."""

    def __init__(self, raw: Any):
        self._raw = raw

    def execute(self, sql: str, params: Sequence[Any] = ()) -> Any:
        statement = _translate(sql)
        if _needs_do_nothing(sql):
            statement = statement.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"

        if IS_POSTGRES:
            cur = self._raw.cursor()
            cur.execute(statement, tuple(params))
            return cur
        return self._raw.execute(statement, tuple(params))

    def commit(self) -> None:
        self._raw.commit()

    def close(self) -> None:
        self._raw.close()


def connect() -> Connection:
    if IS_POSTGRES:
        import psycopg
        from psycopg.rows import dict_row

        return Connection(psycopg.connect(DATABASE_URL, row_factory=dict_row))

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(DB_PATH)
    raw.row_factory = sqlite3.Row
    return Connection(raw)


@contextmanager
def connection() -> Iterator[Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def init_schema() -> None:
    with connection() as conn:
        schema = _POSTGRES_SCHEMA if IS_POSTGRES else _SQLITE_SCHEMA
        if IS_POSTGRES:
            for statement in filter(None, (s.strip() for s in schema.split(";"))):
                conn.execute(statement)
        else:
            conn._raw.executescript(schema)
        conn.commit()


def rows_to_dicts(cursor: Any) -> list[dict]:
    """Normalise the two drivers' row types into plain dicts."""
    return [dict(r) for r in cursor.fetchall()]


def describe() -> str:
    return "postgres" if IS_POSTGRES else f"sqlite:{DB_PATH.name}"
