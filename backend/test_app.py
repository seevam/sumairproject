"""End-to-end checks for the sync + export surface."""

import csv
import io
import os

import pytest

def session_payload(**overrides):
    session = {
        "id": "s_abc",
        "participantId": "P-TEST",
        "age": 16,
        "behaviorType": "student",
        "activityType": "studying",
        "startTime": 1_757_000_000_000,
        "endTime": 1_757_003_600_000,
        "durationSeconds": 3600,
        "sittingSeconds": 3000,
        "mode": "study",
        "avgDeviationPct": 12.5,
        "postureAlerts": 3,
        "breaksPrompted": 2,
        "breaksTaken": 1,
        "breaksSnoozed": 1,
    }
    session.update(overrides)
    return {
        "session": session,
        "events": [
            {"type": "session_start", "timestamp": 1_757_000_000_000},
            {"type": "posture_alert", "timestamp": 1_757_000_120_000, "deviationPct": 28.4, "durationSeconds": 60},
            {"type": "break_prompt", "timestamp": 1_757_001_800_000, "durationSeconds": 1800},
        ],
    }


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.get_json()
    assert body["status"] == "ok"
    assert body["storage"] == "postgres" or body["storage"].startswith("sqlite:")


def test_sync_stores_a_session(client):
    r = client.post("/api/session/sync", json=session_payload())
    assert r.status_code == 200
    assert r.get_json()["events_received"] == 3

    sessions = client.get("/api/sessions").get_json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["participant_id"] == "P-TEST"
    assert sessions[0]["posture_alerts"] == 3


def test_sync_is_idempotent(client):
    """The client retries whatever it could not confirm, so replays must not duplicate."""
    for _ in range(3):
        client.post("/api/session/sync", json=session_payload())

    assert len(client.get("/api/sessions").get_json()["sessions"]) == 1
    csv_body = client.get("/api/events/export").get_data(as_text=True)
    assert csv_body.count("posture_alert") == 1


def test_sync_updates_an_existing_session(client):
    client.post("/api/session/sync", json=session_payload(postureAlerts=1))
    client.post("/api/session/sync", json=session_payload(postureAlerts=7))
    assert client.get("/api/sessions").get_json()["sessions"][0]["posture_alerts"] == 7


def test_sync_rejects_a_payload_without_an_id(client):
    assert client.post("/api/session/sync", json={"session": {}}).status_code == 400


def test_sync_refuses_landmark_data(client):
    """The privacy guarantee is enforced server-side, not just promised client-side."""
    payload = session_payload()
    payload["session"]["landmarks"] = [{"x": 0.5, "y": 0.5}]
    r = client.post("/api/session/sync", json=payload)
    assert r.status_code == 400
    assert "refuses" in r.get_json()["error"]


def export_rows(client):
    """Parse the session export into dicts, so tests do not depend on column order."""
    body = client.get("/api/sessions/export").get_data(as_text=True)
    return list(csv.DictReader(io.StringIO(body)))


def test_session_csv_matches_the_prd_columns(client):
    client.post("/api/session/sync", json=session_payload())
    header = client.get("/api/sessions/export").get_data(as_text=True).strip().splitlines()[0]

    assert header.split(",") == [
        "participant_id", "age", "behavior_type", "preferred_activity",
        "date", "session_start", "session_duration_min",
        "avg_posture_deviation_pct", "posture_alerts_triggered", "breaks_prompted",
        "breaks_taken", "breaks_snoozed", "compliance_rate_pct", "mode",
    ]

    row = export_rows(client)[0]
    assert row["participant_id"] == "P-TEST"
    assert row["session_duration_min"] == "60.0"   # 3600s -> minutes
    assert row["compliance_rate_pct"] == "50.0"    # 1 of 2 breaks taken


def test_compliance_is_100_when_no_break_was_due(client):
    client.post("/api/session/sync", json=session_payload(breaksPrompted=0, breaksTaken=0))
    assert export_rows(client)[0]["compliance_rate_pct"] == "100.0"


def test_profile_is_stored_and_exported(client):
    """Age and persona travel with the session so the dataset is self-contained."""
    client.post("/api/session/sync", json=session_payload(age=16, behaviorType="student", activityType="studying"))
    row = export_rows(client)[0]
    assert row["age"] == "16"
    assert row["behavior_type"] == "student"
    assert row["preferred_activity"] == "studying"


def test_profile_may_be_absent(client):
    """A guest who skipped the profile step must still sync cleanly."""
    payload = session_payload()
    for field in ("age", "behaviorType", "activityType"):
        payload["session"].pop(field, None)
    assert client.post("/api/session/sync", json=payload).status_code == 200

    row = export_rows(client)[0]
    assert row["age"] == ""
    assert row["behavior_type"] == ""


def test_profile_updates_on_resync(client):
    """A participant who fills in their age later must not leave stale rows behind."""
    client.post("/api/session/sync", json=session_payload(age=None, behaviorType=None))
    client.post("/api/session/sync", json=session_payload(age=17, behaviorType="gamer"))
    row = export_rows(client)[0]
    assert row["age"] == "17"
    assert row["behavior_type"] == "gamer"


def test_export_filters_by_participant(client):
    client.post("/api/session/sync", json=session_payload(id="s1", participantId="P-A"))
    client.post("/api/session/sync", json=session_payload(id="s2", participantId="P-B"))

    body = client.get("/api/sessions/export?participant_id=P-A").get_data(as_text=True)
    assert "P-A" in body and "P-B" not in body


def test_events_csv_reports_offset_into_session(client):
    client.post("/api/session/sync", json=session_payload())
    rows = client.get("/api/events/export").get_data(as_text=True).strip().splitlines()
    alert = next(r for r in rows if "posture_alert" in r)
    assert alert.split(",")[4] == "120"   # 120s after session start


def test_stats(client):
    client.post("/api/session/sync", json=session_payload(id="s1", participantId="P-A"))
    client.post("/api/session/sync", json=session_payload(id="s2", participantId="P-B"))
    stats = client.get("/api/stats").get_json()
    assert stats["sessions"] == 2
    assert stats["participants"] == 2


def test_participant_withdrawal_removes_everything(client):
    client.post("/api/session/sync", json=session_payload())
    assert client.delete("/api/participant/P-TEST").get_json()["deleted_sessions"] == 1
    assert client.get("/api/sessions").get_json()["sessions"] == []
    assert "posture_alert" not in client.get("/api/events/export").get_data(as_text=True)


# --- guest-first auth -------------------------------------------------------
#
# PostureGuard must keep working for anonymous clients, so the default mode is
# "disabled": no Clerk key, anonymous sync accepted. These tests pin that
# behaviour down so it cannot regress into an auth wall.


def test_auth_defaults_to_disabled(client):
    assert client.get("/api/health").get_json()["auth"] == "disabled"


def test_guest_sync_is_accepted_without_a_token(client):
    assert client.post("/api/session/sync", json=session_payload()).status_code == 200


def test_guest_session_is_stored_with_no_owner(client):
    client.post("/api/session/sync", json=session_payload())
    assert client.get("/api/sessions").get_json()["sessions"][0]["user_id"] is None


def test_required_mode_rejects_an_anonymous_request(monkeypatch, client):
    """With CLERK_REQUIRE_AUTH set, a guest sync must be refused rather than stored."""
    import auth as clerk_auth

    monkeypatch.setattr(clerk_auth, "mode", lambda: "required")
    r = client.post("/api/session/sync", json=session_payload())
    assert r.status_code == 401
    assert client.get("/api/sessions").get_json()["sessions"] == []


def test_signed_in_user_sees_only_their_own_sessions(monkeypatch, client):
    import auth as clerk_auth

    def as_user(user_id):
        monkeypatch.setattr(
            clerk_auth, "identify",
            lambda _req, uid=user_id: clerk_auth.Identity(user_id=uid, authenticated=True),
        )

    as_user("user_alice")
    client.post("/api/session/sync", json=session_payload(id="s_alice"))

    as_user("user_bob")
    client.post("/api/session/sync", json=session_payload(id="s_bob"))

    sessions = client.get("/api/sessions").get_json()["sessions"]
    assert [s["id"] for s in sessions] == ["s_bob"]

    as_user("user_alice")
    sessions = client.get("/api/sessions").get_json()["sessions"]
    assert [s["id"] for s in sessions] == ["s_alice"]


def test_resync_does_not_strip_an_existing_owner(monkeypatch, client):
    """A later anonymous retry must not orphan a session that was owned."""
    import auth as clerk_auth

    monkeypatch.setattr(
        clerk_auth, "identify",
        lambda _req: clerk_auth.Identity(user_id="user_alice", authenticated=True),
    )
    client.post("/api/session/sync", json=session_payload())

    monkeypatch.setattr(clerk_auth, "identify", lambda _req: clerk_auth.GUEST)
    client.post("/api/session/sync", json=session_payload(postureAlerts=9))

    monkeypatch.setattr(
        clerk_auth, "identify",
        lambda _req: clerk_auth.Identity(user_id="user_alice", authenticated=True),
    )
    rows = client.get("/api/sessions").get_json()["sessions"]
    assert len(rows) == 1
    assert rows[0]["user_id"] == "user_alice"
    assert rows[0]["posture_alerts"] == 9


def test_identify_returns_guest_when_clerk_is_not_configured():
    import auth as clerk_auth

    assert clerk_auth.configured() is False
    assert clerk_auth.identify(object()).is_guest is True


def test_implausible_age_is_dropped_not_stored(client):
    """A malformed age must not overflow the column or poison the grouping."""
    for bad in (True, -4, 10**12, "16"):
        r = client.post("/api/session/sync", json=session_payload(age=bad))
        assert r.status_code == 200
        assert export_rows(client)[0]["age"] == ""


def _legacy_sessions_ddl(with_user_id: bool, postgres: bool) -> str:
    """The sessions table as an earlier release created it."""
    big = "BIGINT" if postgres else "INTEGER"
    real = "DOUBLE PRECISION" if postgres else "REAL"
    user = "user_id TEXT," if with_user_id else ""
    return (
        f"CREATE TABLE sessions (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, {user}"
        f" start_time {big} NOT NULL, end_time {big}, duration_seconds {big} NOT NULL DEFAULT 0,"
        f" sitting_seconds {big} NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'study',"
        f" avg_deviation_pct {real} NOT NULL DEFAULT 0, posture_alerts INTEGER NOT NULL DEFAULT 0,"
        f" breaks_prompted INTEGER NOT NULL DEFAULT 0, breaks_taken INTEGER NOT NULL DEFAULT 0,"
        f" breaks_snoozed INTEGER NOT NULL DEFAULT 0, received_at {big} NOT NULL)"
    )


@pytest.mark.parametrize(
    "release,with_user_id",
    [
        # Before auth: no user_id. Startup used to crash here, because the create
        # script indexed user_id before any migration could add it.
        ("first deploy (87d9b3c)", False),
        # After auth, before the profile: user_id present, profile columns absent.
        ("auth (7475b25)", True),
    ],
)
def test_existing_database_is_upgraded_in_place(tmp_path, monkeypatch, release, with_user_id):
    """A database from any earlier release must start, accept syncs and keep its rows."""
    import importlib

    postgres = os.environ.get("DATABASE_URL", "").startswith(("postgres://", "postgresql://"))
    if not postgres:
        monkeypatch.setenv("POSTUREGUARD_DB", str(tmp_path / "old.db"))

    import db as db_module

    importlib.reload(db_module)

    # Recreate the old release's tables, with one session already in them.
    with db_module.connection() as conn:
        conn.execute("DROP TABLE IF EXISTS events")
        conn.execute("DROP TABLE IF EXISTS sessions")
        conn.execute(_legacy_sessions_ddl(with_user_id, postgres))
        conn.execute(
            "INSERT INTO sessions (id, participant_id, start_time, end_time, received_at)"
            " VALUES (?, ?, ?, ?, ?)",
            ("s_legacy", "P-LEGACY", 1_756_000_000_000, 1_756_000_600_000, 1_756_000_600_000),
        )
        conn.commit()

    import app as app_module

    importlib.reload(app_module)
    client = app_module.create_app().test_client()  # must not raise

    assert client.post("/api/session/sync", json=session_payload()).status_code == 200, release

    rows = {r["participant_id"]: r for r in export_rows(client)}
    assert rows["P-TEST"]["age"] == "16"
    assert rows["P-TEST"]["behavior_type"] == "student"
    # Upgrading must not lose what the old release had already collected.
    assert rows["P-LEGACY"]["age"] == ""


def test_schema_upgrade_is_idempotent(client):
    """Every cold start re-runs the upgrade; running it again must be a no-op."""
    import db as db_module

    db_module.init_schema()
    db_module.init_schema()
    assert client.post("/api/session/sync", json=session_payload()).status_code == 200
