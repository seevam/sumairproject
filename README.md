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

## Design system

The V1 mockup supersedes the original PRD palette: the background is a
green-tinted near-black rather than the PRD's navy `#0A1628`.

| Token | Value | Use |
|---|---|---|
| `bg` | `#050A07` | Page background |
| `surface` | `#0B120E` | Cards |
| `surface-2` | `#111A15` | Inputs, icon tiles, nested rows |
| `accent` | `#4ADE80` | Primary green |
| `line` | `#1C2A22` | Borders |
| `muted` | `#7C8F85` | Secondary text |
| `warn` / `danger` | `#F0A500` / `#F04438` | Warning and poor posture |

Primary buttons use a vertical green gradient with dark text. Canvas and SVG
colours live in `src/lib/theme.ts`, which mirrors `tailwind.config.js`.

## Privacy

This is the core design constraint, not a feature bolted on afterwards.

- **Video never leaves the device.** MediaPipe runs as WebAssembly inside the browser tab. The WASM runtime, the model file and the webfont are all self-hosted, so the app makes **no third-party request at all** — not even for fonts.
- **No frames are stored.** Landmarks become four numbers and are discarded.
- **Guest-first.** No account is needed for anything: calibrate, run sessions, and export data without ever entering an email address. Sign-in only adds cross-device sync. In a build with no Clerk key the SDK is never even downloaded.
- **Local-first storage.** Sessions live in the browser's IndexedDB. Sync is **off by default** — even when the deployment ships a backend, Settings shows a one-click opt-in rather than switching it on for you. With sync off, nothing is transmitted anywhere, ever.
- **The optional backend refuses landmark data.** `POST /api/session/sync` rejects any payload containing landmark, frame, or image fields — the guarantee is enforced server-side, not just promised client-side.
- **Visible camera indicator** whenever the stream is live, and one-click deletion of all local data in Settings.

---

## User profile

Collected on onboarding step 3 and editable in Settings:

| Field | Feeds |
|---|---|
| **Age** | The fallback posture model when calibration is skipped, and a grouping variable in the pilot analysis |
| **Behaviour type** (student / gamer / worker) | Which mode you start in — gamers begin in Entertainment, students and workers in Study |
| **Preferred activity** (studying / gaming / working) | Recorded with each session |

Behaviour type and preferred activity look similar but do different jobs:
behaviour type is a **stable persona** that picks your defaults, while activity is
**what you are doing in this session** and can differ from it. Both are exported.

> On age and calibration: head size relative to shoulder breadth decreases through
> adolescence, so a younger participant's nose sits proportionally higher above
> the shoulder line at the same posture. `defaultBaseline(age)` nudges the
> fallback ratio for that. It is a coarse anthropometric approximation, **not a
> validated model**, and it only applies to users who skip calibration — a real
> capture replaces it entirely.

## Modes

Study and Entertainment each keep their **own saved settings**. Switching modes
loads that mode's configuration; it never carries the other mode's values across.

| | Study (default) | Entertainment (default) |
|---|---|---|
| Break interval | 45 min | 30 min |
| Posture sensitivity | Medium (15%) | High (10%) |
| Alert after slouching for | 90 s | 60 s |
| Alert channels | All three | All three |

Every one of those is editable per mode in **Settings → Modes**, where both
editors are shown at once so each can be configured in a single visit. Set them
up once, then just toggle.

## Authentication

Clerk, wired guest-first. Auth is genuinely optional at every layer:

| Layer | Without Clerk configured | With Clerk configured |
|---|---|---|
| Frontend | Guest-only. The Clerk chunk is never requested, so no third-party code loads. | Sign-in and sign-up on `/auth`, with "Continue as Guest" still present. |
| Backend | `auth=disabled`. Anonymous sync accepted. | `auth=optional` — a token attaches a user id; anonymous still accepted. Set `CLERK_REQUIRE_AUTH=1` for `auth=required`. |

Signed-in users only ever get their own sessions back from `/api/sessions`. A
guest re-sync never strips an owner off a session that was already claimed.

`GET /api/health` reports the active mode, so you can confirm what a deployment
is actually doing.

Frontend env: `VITE_CLERK_PUBLISHABLE_KEY`.
Backend env: `CLERK_SECRET_KEY` and/or `CLERK_JWT_KEY` (the PEM key verifies
locally with no outbound request per API call), plus optional
`CLERK_AUTHORIZED_PARTIES` and `CLERK_REQUIRE_AUTH`.

> **Why guest-first matters here.** The pilot studies adolescents. Running
> participants in guest mode means no minor's email address is stored on a
> third-party service, and the privacy section of the paper holds without
> qualification. Sign-in exists for the demo and for anyone who wants sync.

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
cd frontend && npm test              # 96 unit tests: posture maths, calibration, CSV, sync, settings, session engine
cd backend  && python -m pytest -q   # 22 API tests (SQLite)

# The backend suite must also pass against Postgres, which is what production uses:
cd backend && DATABASE_URL=postgresql://... python -m pytest -q
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

A second end-to-end script covers the deployed topology — that sync stays off
until the user opts in, that a completed session reaches the backend, and that
the server refuses a payload carrying landmark data:

```bash
cd backend && python app.py &        # /api on the same origin via the vite proxy
cd frontend && npm run test:sync
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

Both services deploy as **one Vercel project** from the repo-root `vercel.json`.
Vercel builds each service separately and serves them on a single domain:

| Path | Service | Root |
|---|---|---|
| `/api/*` | Python (Flask) | `backend/` |
| everything else | Vite SPA | `frontend/` |

Vercel loads the `app` instance in `backend/app.py` directly — it is a supported
Python entrypoint, so no wrapper module is needed. A rewrite that targets a
service forwards the **original path**, so Flask's own `/api/...` routes match
unchanged.

Because the API is same-origin, there is no CORS preflight and nothing to
configure in the frontend to point it at the backend.

### Required: set `DATABASE_URL`

**Vercel Functions have an ephemeral filesystem.** A SQLite file written there is
discarded when the instance is recycled, so the backend would accept sessions and
silently lose them. Set `DATABASE_URL` to a Postgres connection string (Vercel
Postgres, Neon, Supabase — any of them) and `backend/db.py` uses Postgres instead.

Without `DATABASE_URL` the backend still starts and still answers, but **the
server-side data is not durable**. That is fine for a demo and fatal for a
two-week study. Local development needs nothing: it falls back to SQLite.

Check which one is live at any time:

```bash
curl https://your-app.vercel.app/api/health
# {"status":"ok","storage":"postgres",...}
```

### Local development with the same topology

The Vite dev and preview servers proxy `/api` to `http://127.0.0.1:5000`, so
local runs match production exactly:

```bash
cd backend && python app.py          # terminal 1
cd frontend && npm run dev           # terminal 2 - /api is proxied for you
```

Override the target with `VITE_DEV_API_TARGET` if the backend runs elsewhere.

### Alternative: separate hosts

`backend/render.yaml` and `backend/Procfile` still work if you would rather run
the backend on Render or any other host. In that case set `ALLOWED_ORIGINS` to
your frontend origin (CORS is needed again) and enter the backend URL in
**Settings → Research**.

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
participant_id, age, behavior_type, preferred_activity,
date, session_start, session_duration_min,
avg_posture_deviation_pct, posture_alerts_triggered, breaks_prompted,
breaks_taken, breaks_snoozed, compliance_rate_pct, mode
```

The profile columns travel with each row, so the dataset can be grouped by age
or persona without joining a second file.

`postureguard_events_YYYY-MM-DD.csv` — the within-session timeline (one row per
event, with seconds-into-session), for time-to-correction analysis.

---

## Configuration reference

| Setting | Scope | Options |
|---|---|---|
| Mode | Global | Study / Entertainment |
| Break interval | **Per mode** | 30 / 45 / 60 min |
| Posture sensitivity | **Per mode** | Low (22%) / Medium (15%) / High (10%) |
| Alert dwell | **Per mode** | 45 / 60 / 90 / 120 s |
| Alert channels | **Per mode** | In-app badge, audio, desktop notification |
| Age, behaviour type, activity | Profile | See above |

Fixed thresholds: presence grace period 60s, minimum break 3 min of landmark
absence, snooze 5 min once per break.

### Camera profile — front-facing only

Confirmed decision. The deviation maths reads the nose against the shoulder
line, which is only meaningful from the front; a rear or side camera would
produce landmarks it cannot interpret. So no other orientation is offered and
there is no device picker.

`facingMode: 'user'` is set as a *preference*, not `exact`, on purpose: most
laptop and USB webcams do not report a facingMode at all, and an exact
constraint fails outright on those machines. Audio is never requested.

---

## Not in this build

Deferred by scope decision, listed here so the gap is explicit:

- Flask-SocketIO real-time channel — timers run client-side, which removes a failure mode rather than adding one
- Cross-device sync of calibration baselines (sessions sync; the baseline stays local)
- Mobile app, Raspberry Pi device, Apple Health / Google Fit — V2 and beyond

---

Sumair (student) · Shivam Sahu (mentor) · Ascend Now
