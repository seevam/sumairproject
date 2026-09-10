"""End-to-end checks for the sync + export surface."""

import json
import os
import tempfile

import pytest


@pytest.fixture()
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["POSTUREGUARD_DB"] = path

    import importlib
    import app as app_module

    importlib.reload(app_module)
    application = app_module.create_app()
    application.config["TESTING"] = True
    with application.test_client() as c:
        yield c
    os.unlink(path)


def session_payload(**overrides):
    session = {
        "id": "s_abc",
        "participantId": "P-TEST",
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
    assert r.get_json()["status"] == "ok"


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


def test_session_csv_matches_the_prd_columns(client):
    client.post("/api/session/sync", json=session_payload())
    body = client.get("/api/sessions/export").get_data(as_text=True)
    header, row = body.strip().splitlines()[:2]

    assert header.split(",") == [
        "participant_id", "date", "session_start", "session_duration_min",
        "avg_posture_deviation_pct", "posture_alerts_triggered", "breaks_prompted",
        "breaks_taken", "breaks_snoozed", "compliance_rate_pct", "mode",
    ]
    fields = row.split(",")
    assert fields[0] == "P-TEST"
    assert fields[3] == "60.0"          # 3600s -> minutes
    assert fields[9] == "50.0"          # 1 of 2 breaks taken


def test_compliance_is_100_when_no_break_was_due(client):
    client.post("/api/session/sync", json=session_payload(breaksPrompted=0, breaksTaken=0))
    row = client.get("/api/sessions/export").get_data(as_text=True).strip().splitlines()[1]
    assert row.split(",")[9] == "100.0"


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
