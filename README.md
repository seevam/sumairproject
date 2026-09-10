# PostureGuard

Camera-based posture and sedentary-behaviour monitoring for desk-based adolescents.
All pose processing runs on-device in the browser — no image ever leaves the machine.

**Status:** V1 pilot (vertical slice). Web app is functional end to end: calibration →
live monitoring → posture alerts → break reminders → session summary → CSV export.

---

## What it does

PostureGuard watches your posture through the laptop camera and delivers
Just-in-Time Adaptive Interventions (JITAIs) when it detects a problem:

| Intervention | Trigger |
|---|---|
| **Posture alert** | Deviation from your calibrated baseline exceeds the threshold for a sustained period (60s in Entertainment Mode, 90s in Study Mode) |
| **Break reminder** | Continuous sitting reaches your break interval (30 / 45 / 60 min) |

Alerts are delivered through any combination of an in-app badge, an audio chime,
and a desktop notification.

### How posture is measured

Five MediaPipe landmarks — nose, both ears, both shoulders — are reduced to four
**scale-invariant** numbers, so moving nearer to or further from the camera does not
by itself register as a posture change:

| Metric | Detects |
|---|---|
| Neck angle from vertical | Head leaning left/right |
| Neck ratio (shoulder-mid → nose, over shoulder width) | Forward-head posture, slouching |
| Shoulder width | Leaning in toward the screen |
| Shoulder tilt | Uneven shoulders |

These are compared against your calibrated baseline and combined into a single
weighted deviation percentage. **Only worse-than-baseline posture counts** —
sitting up straighter than you calibrated never scores against you.

The raw signal passes through a median filter (rejects single-frame landmark
glitches) and then an exponential moving average (smooths jitter) before it
reaches any threshold.

---

## Privacy

This is the core design constraint, not a feature bolted on afterwards.

- **Video never leaves the device.** MediaPipe runs as WebAssembly inside the browser tab. The WASM runtime, the model file and the webfont are all self-hosted, so the app makes **no third-party request at all** — not even for fonts.
- **No frames are stored.** Landmarks become four numbers and are discarded.
- **Local-first storage.** Sessions live in the browser's IndexedDB. With no backend URL configured, nothing is transmitted anywhere, ever.
- **The optional backend refuses landmark data.** `POST /api/session/sync` rejects any payload containing landmark, frame, or image fields — the guarantee is enforced server-side, not just promised client-side.
- **Visible camera indicator** whenever the stream is live, and one-click deletion of all local data in Settings.

---

## Repository layout

```
frontend/          React + TypeScript + Vite + Tailwind
  src/lib/         posture maths, MediaPipe engine, IndexedDB, CSV, notifications
  src/store/       settings + session engine (zustand)
  src/hooks/       camera stream, pose detection loop
  src/pages/       the routed screens
  public/wasm/     self-hosted MediaPipe WASM runtime
  public/models/   self-hosted pose_landmarker_lite.task
backend/           Flask + SQLite — optional sync mirror and CSV export
```

---

## Running locally

Camera access requires a secure context. `localhost` counts as secure, so local
development works without any HTTPS setup.

### Frontend

```bash
cd frontend
npm install          # also copies the MediaPipe WASM runtime into public/
npm run dev          # http://localhost:5173
```

### Backend (optional)

The app is fully functional without it. Run it only if you want sessions
mirrored to a central database.

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python app.py        # http://localhost:5000
```

Then set the backend URL in the app's **Settings → Research → Backend URL**,
or create `frontend/.env` with `VITE_API_BASE_URL=http://localhost:5000`.

---

## Tests

```bash
cd frontend && npm test     # 51 unit tests: posture maths, CSV, session engine
cd backend  && python -m pytest -q   # 12 API tests
```

The session-engine suite drives the JITAI timing logic directly — break
intervals, posture dwell times, snooze rules, presence detection and the
absence-based break completion — by stepping the engine's heartbeat, so an hour
of session time is verified in milliseconds.

End-to-end smoke test against a real browser with a fake camera device:

```bash
cd frontend
npm run build && npm run preview &
npm run smoke
# or against a deployment:
SMOKE_BASE_URL=https://your-app.vercel.app npm run smoke
```

---

## Dev / test mode

The behaviours worth demonstrating live on 60-second and 30-minute timescales.
Rather than wait one out, open any page with **`?dev=1`** or press
**Ctrl+Shift+D**.

- **Clock speed** — 1x / 10x / 60x / 300x. At 60x a 30-minute break interval arrives in 30 seconds.
- **Force deviation** — pin the posture signal to good / warning / poor without moving.
- **Simulate user away** — test presence detection and break completion without leaving your chair.
- **Trigger break prompt now** — jump straight to the break flow.
- A live readout of the engine's internal state.

Overrides are cleared automatically when the panel is hidden, so a demo setting
can never silently corrupt a real session.

---

## Deployment

### Frontend → Vercel

1. Import the repo, set **Root Directory** to `frontend`.
2. `vercel.json` already handles the SPA rewrites, asset caching and the
   `Permissions-Policy: camera=(self)` header.
3. Optionally set `VITE_API_BASE_URL` to your backend origin.

HTTPS comes free with Vercel, which the camera API requires.

### Backend → Render

1. `render.yaml` is a blueprint — point Render at the repo and it picks it up.
2. Set `ALLOWED_ORIGINS` to your Vercel origin so CORS is not left wide open.

> **Free-tier caveat:** Render's filesystem is ephemeral and the service spins
> down when idle, so the server-side SQLite file is not durable. This does not
> put the pilot dataset at risk — the browser holds the authoritative copy and
> re-syncs — but **export the CSV from the browser**, not the server, when
> collecting the study data.

---

## Running the pilot study

1. Each participant opens the deployed URL and completes calibration once.
2. In **Settings → Research**, note the auto-generated **Participant ID** (random,
   contains no personal information). Record which ID belongs to which participant
   separately, offline.
3. Set Mode and break interval to match how they actually use their desk.
4. Participants press **Start session** when they sit down and **End session**
   when they finish.
5. At the end of the two weeks, each participant opens **Data → Export sessions CSV**
   and sends the file.

### Export format

`postureguard_sessions_YYYY-MM-DD.csv` — one row per session:

```
participant_id, date, session_start, session_duration_min,
avg_posture_deviation_pct, posture_alerts_triggered, breaks_prompted,
breaks_taken, breaks_snoozed, compliance_rate_pct, mode
```

`postureguard_events_YYYY-MM-DD.csv` — the within-session timeline (one row per
event, with seconds-into-session), for time-to-correction analysis.

---

## Configuration reference

| Setting | Options | Default |
|---|---|---|
| Mode | Study / Entertainment | Study |
| Break interval | 30 / 45 / 60 min | Follows mode (45 / 30) |
| Posture sensitivity | Low (22%) / Medium (15%) / High (10%) | Medium |
| Alert channels | In-app badge, audio, desktop notification | All three |

Fixed thresholds: presence grace period 60s, minimum break 3 min of landmark
absence, snooze 5 min once per break.

---

## Not in this build

Deferred by scope decision, listed here so the gap is explicit:

- Email/password accounts and the 4-step onboarding walkthrough — settings and calibration currently cover their function, and data is per-device
- Guest vs. signed-in distinction (everything is local, so every user is effectively a guest)
- Flask-SocketIO real-time channel — timers run client-side, which removes a failure mode rather than adding one
- Mobile app, Raspberry Pi device, Apple Health / Google Fit — V2 and beyond

---

Sumair (student) · Shivam Sahu (mentor) · Ascend Now
