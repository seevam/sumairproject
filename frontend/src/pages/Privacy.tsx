import { Link } from 'react-router-dom'

const POINTS = [
  {
    title: 'Video never leaves your device',
    body: 'The camera stream is handed directly to MediaPipe, which runs as WebAssembly inside this browser tab. No frame is uploaded, and no frame is written to disk. There is no server that could receive one.',
  },
  {
    title: 'Only coordinates are used',
    body: 'PostureGuard reads five points - your nose, both ears and both shoulders - as x/y numbers between 0 and 1. Those numbers are turned into four angles and ratios, compared against your baseline, and then discarded. They are not stored frame by frame.',
  },
  {
    title: 'You can always see when the camera is on',
    body: 'A green indicator appears in the header whenever the stream is live, alongside your operating system’s own camera light. The stream is opened when a session starts and closed the moment it ends.',
  },
  {
    title: 'Your data stays on this computer',
    body: 'Sessions, events and your calibration live in this browser’s local database. If you leave the backend URL blank in Settings, nothing is ever sent anywhere. If you set one, only aggregate numbers and event timestamps are mirrored - never images, never landmarks.',
  },
  {
    title: 'You can delete everything',
    body: 'Settings has a single button that erases every session, event and calibration record from this device. It takes effect immediately and cannot be undone.',
  },
]

export function Privacy() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Privacy</h1>
        <p className="text-muted">
          PostureGuard watches your posture without watching you. Here is exactly what that means.
        </p>
      </header>

      <ol className="space-y-3">
        {POINTS.map((p, i) => (
          <li key={p.title} className="card flex gap-4 p-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-bold text-accent">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{p.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="card p-4">
        <p className="text-sm font-semibold">Taking part in the pilot study</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Data shared with the study is the exported CSV only: one row per session with duration, average posture
          deviation, alert counts and break compliance, labelled with a random participant ID. It contains no name,
          no email and no images.
        </p>
      </div>

      <Link to="/settings" className="btn-secondary">Back to settings</Link>
    </div>
  )
}
