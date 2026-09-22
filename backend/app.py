"""
PostureGuard backend.

Deliberately small. The web app is local-first: every session is written to the
browser's IndexedDB first and stays valid there. This service is an optional
mirror so a researcher can collect several participants' data in one place
without walking round with a USB stick.

What it never receives: camera frames, images, or pose landmark coordinates.
Those stay in the browser by design (PRD 7.6). This service only ever sees
aggregate session numbers and event timestamps.

Deploys either as a Vercel service (see the root vercel.json - Vercel loads the
``app`` instance below directly) or as a normal gunicorn process. Storage is
Postgres when DATABASE_URL is set, SQLite otherwise; see db.py for why that
matters on serverless hosts.
"""

from __future__ import annotations

import csv
import io
import os
from datetime import datetime, timezone

from flask import Flask, Response, g, jsonify, request
from flask_cors import CORS

import auth as clerk_auth
import db as store

SESSION_CSV_HEADER = [
    "participant_id",
    "age",
    "behavior_type",
    "preferred_activity",
    "date",
    "session_start",
    "session_duration_min",
    "avg_posture_deviation_pct",
    "posture_alerts_triggered",
    "breaks_prompted",
    "breaks_taken",
    "breaks_snoozed",
    "compliance_rate_pct",
    "mode",
]


def get_db() -> store.Connection:
    """One connection per request, closed by the teardown handler below."""
    if "db" not in g:
        g.db = store.connect()
    return g.db


def create_app() -> Flask:
    app = Flask(__name__)

    # The frontend is served from a different origin (Vercel) than the API
    # (Render), so the browser needs CORS. Restrict it when ALLOWED_ORIGINS is set.
    origins = os.environ.get("ALLOWED_ORIGINS", "*")
    CORS(app, resources={r"/api/*": {"origins": origins.split(",") if origins != "*" else "*"}})

    store.init_schema()

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.get("/api/health")
    def health():
        return jsonify(
            status="ok",
            storage=store.describe(),
            auth=clerk_auth.mode(),
            time=datetime.now(timezone.utc).isoformat(),
        )

    @app.post("/api/session/sync")
    def sync_session():
        """Upsert one session and its events.

        Idempotent: the client retries whatever it has not confirmed, so the
        same session may arrive several times. Sessions upsert by id and events
        are deduplicated on (session, type, timestamp).
        """
        payload = request.get_json(silent=True) or {}
        session = payload.get("session")
        events = payload.get("events") or []

        identity = clerk_auth.identify(request)
        if clerk_auth.mode() == "required" and identity.is_guest:
            return jsonify(error="authentication required"), 401

        if not isinstance(session, dict) or not session.get("id"):
            return jsonify(error="session with an id is required"), 400

        # Guard against a client that has been modified to send landmark data.
        rejected = {"landmarks", "frame", "image", "video", "calibration"}
        if rejected & set(session):
            return jsonify(error="payload contains fields this service refuses to store"), 400

        db = get_db()
        db.execute(
            """
            INSERT INTO sessions (
                id, participant_id, user_id, age, behavior_type, activity_type,
                start_time, end_time, duration_seconds,
                sitting_seconds, mode, avg_deviation_pct, posture_alerts,
                breaks_prompted, breaks_taken, breaks_snoozed, received_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                user_id           = COALESCE(excluded.user_id, sessions.user_id),
                age               = excluded.age,
                behavior_type     = excluded.behavior_type,
                activity_type     = excluded.activity_type,
                end_time          = excluded.end_time,
                duration_seconds  = excluded.duration_seconds,
                sitting_seconds   = excluded.sitting_seconds,
                avg_deviation_pct = excluded.avg_deviation_pct,
                posture_alerts    = excluded.posture_alerts,
                breaks_prompted   = excluded.breaks_prompted,
                breaks_taken      = excluded.breaks_taken,
                breaks_snoozed    = excluded.breaks_snoozed,
                received_at       = excluded.received_at
            """,
            (
                session["id"],
                str(session.get("participantId", "unknown"))[:64],
                identity.user_id,
                int(session["age"]) if isinstance(session.get("age"), (int, float)) else None,
                str(session["behaviorType"])[:32] if session.get("behaviorType") else None,
                str(session["activityType"])[:32] if session.get("activityType") else None,
                int(session.get("startTime") or 0),
                int(session["endTime"]) if session.get("endTime") else None,
                int(session.get("durationSeconds") or 0),
                int(session.get("sittingSeconds") or 0),
                str(session.get("mode", "study"))[:32],
                float(session.get("avgDeviationPct") or 0),
                int(session.get("postureAlerts") or 0),
                int(session.get("breaksPrompted") or 0),
                int(session.get("breaksTaken") or 0),
                int(session.get("breaksSnoozed") or 0),
                int(datetime.now(timezone.utc).timestamp() * 1000),
            ),
        )

        for event in events:
            if not isinstance(event, dict):
                continue
            db.execute(
                """
                INSERT OR IGNORE INTO events
                    (session_id, type, timestamp, deviation_pct, duration_seconds)
                VALUES (?,?,?,?,?)
                """,
                (
                    session["id"],
                    str(event.get("type", ""))[:64],
                    int(event.get("timestamp") or 0),
                    float(event["deviationPct"]) if event.get("deviationPct") is not None else None,
                    int(event["durationSeconds"]) if event.get("durationSeconds") is not None else None,
                ),
            )

        db.commit()
        return jsonify(session_id=session["id"], events_received=len(events))

    @app.get("/api/sessions")
    def list_sessions():
        identity = clerk_auth.identify(request)
        participant = request.args.get("participant_id")

        sql = "SELECT * FROM sessions WHERE end_time IS NOT NULL"
        params: list = []
        if identity.authenticated:
            # A signed-in user gets their own data back, never anyone else's.
            sql += " AND user_id = ?"
            params.append(identity.user_id)
        if participant:
            sql += " AND participant_id = ?"
            params.append(participant)
        sql += " ORDER BY start_time DESC LIMIT 1000"

        rows = store.rows_to_dicts(get_db().execute(sql, params))
        return jsonify(sessions=rows)

    @app.get("/api/sessions/export")
    def export_sessions():
        """The pilot-study dataset, with the exact columns the paper reports."""
        participant = request.args.get("participant_id")
        sql = "SELECT * FROM sessions WHERE end_time IS NOT NULL"
        params: list = []
        if participant:
            sql += " AND participant_id = ?"
            params.append(participant)
        sql += " ORDER BY participant_id, start_time"

        rows = store.rows_to_dicts(get_db().execute(sql, params))

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(SESSION_CSV_HEADER)
        for r in rows:
            prompted = r["breaks_prompted"]
            compliance = round(r["breaks_taken"] / prompted * 100, 1) if prompted else 100.0
            start = datetime.fromtimestamp(r["start_time"] / 1000, tz=timezone.utc)
            writer.writerow(
                [
                    r["participant_id"],
                    r["age"] if r["age"] is not None else "",
                    r["behavior_type"] or "",
                    r["activity_type"] or "",
                    start.date().isoformat(),
                    start.isoformat(),
                    round(r["duration_seconds"] / 60, 1),
                    round(r["avg_deviation_pct"], 1),
                    r["posture_alerts"],
                    prompted,
                    r["breaks_taken"],
                    r["breaks_snoozed"],
                    compliance,
                    r["mode"],
                ]
            )

        stamp = datetime.now(timezone.utc).date().isoformat()
        return Response(
            buf.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename=postureguard_sessions_{stamp}.csv"},
        )

    @app.get("/api/events/export")
    def export_events():
        rows = store.rows_to_dicts(
            get_db().execute(
                """
                SELECT e.*, s.participant_id, s.start_time AS session_start
                FROM events e
                JOIN sessions s ON s.id = e.session_id
                ORDER BY e.timestamp
                """
            )
        )

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            ["participant_id", "session_id", "event_type", "timestamp", "seconds_into_session", "deviation_pct", "duration_seconds"]
        )
        for r in rows:
            writer.writerow(
                [
                    r["participant_id"],
                    r["session_id"],
                    r["type"],
                    datetime.fromtimestamp(r["timestamp"] / 1000, tz=timezone.utc).isoformat(),
                    round((r["timestamp"] - r["session_start"]) / 1000),
                    r["deviation_pct"] if r["deviation_pct"] is not None else "",
                    r["duration_seconds"] if r["duration_seconds"] is not None else "",
                ]
            )

        return Response(
            buf.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=postureguard_events.csv"},
        )

    @app.get("/api/stats")
    def stats():
        rows = store.rows_to_dicts(
            get_db().execute(
                """
                SELECT COUNT(*)                         AS sessions,
                       COUNT(DISTINCT participant_id)   AS participants,
                       COALESCE(SUM(sitting_seconds),0) AS sitting_seconds,
                       COALESCE(SUM(posture_alerts),0)  AS posture_alerts
                FROM sessions WHERE end_time IS NOT NULL
                """
            )
        )
        return jsonify(rows[0])

    @app.delete("/api/participant/<participant_id>")
    def delete_participant(participant_id: str):
        """Honours a withdrawal request: removes every trace of one participant."""
        db = get_db()
        db.execute(
            "DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE participant_id = ?)",
            (participant_id,),
        )
        cur = db.execute("DELETE FROM sessions WHERE participant_id = ?", (participant_id,))
        db.commit()
        return jsonify(deleted_sessions=cur.rowcount)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
