import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loadCalibration, saveCalibration } from '../lib/db'
import { defaultBaseline } from '../lib/posture'
import { useSettings } from '../store/settings'
import type { CalibrationBaseline } from '../types'
import { shortDate, shortTime } from '../lib/time'

const STEPS = [
  { title: 'Sit the way you want to sit', body: 'Upright, back against the chair, feet flat. This becomes your target posture.' },
  { title: 'Look straight at the screen', body: 'Head and both shoulders need to be inside the camera frame.' },
  { title: 'Hold still for 10 seconds', body: 'PostureGuard averages your position over the capture to cancel out small movements.' },
]

export function Calibrate() {
  const navigate = useNavigate()
  const age = useSettings((s) => s.profile.age)
  const [existing, setExisting] = useState<CalibrationBaseline | null>(null)
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    void loadCalibration().then((c) => setExisting(c ?? null))

    // A device probe, not a permission request: enumerateDevices lists video
    // inputs without prompting, so we can show status before asking for access.
    async function probe() {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setCameraAvailable(false)
        return
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setCameraAvailable(devices.some((d) => d.kind === 'videoinput'))
      } catch {
        setCameraAvailable(false)
      }
    }
    void probe()
  }, [])

  async function useDefault() {
    // Age only shapes the fallback model; a real capture overrides it entirely.
    await saveCalibration(defaultBaseline(age))
    navigate('/dashboard')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Calibrate your posture</h1>
        <p className="text-muted">
          PostureGuard needs one snapshot of your good posture to compare against. It takes about fifteen seconds.
        </p>
      </header>

      {existing && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="flex-1">
            <p className="text-sm font-medium">
              {existing.isDefault ? 'Using the default posture model' : 'Baseline already captured'}
            </p>
            <p className="text-xs text-muted">
              {existing.isDefault
                ? 'Accurate enough to start, but a real capture is noticeably better.'
                : `Captured ${shortDate(existing.createdAt)} at ${shortTime(existing.createdAt)}.`}
            </p>
          </div>
          <Link to="/dashboard" className="btn-secondary">Go to dashboard</Link>
        </div>
      )}

      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="card flex gap-4 p-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{step.title}</p>
              <p className="text-sm text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="card flex items-center gap-3 p-4">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            cameraAvailable === null ? 'bg-muted' : cameraAvailable ? 'bg-accent' : 'bg-danger'
          }`}
        />
        <p className="text-sm">
          {cameraAvailable === null && 'Checking for a camera...'}
          {cameraAvailable === true && 'Camera detected. You will be asked for permission on the next screen.'}
          {cameraAvailable === false && 'No camera detected. You can still use the default posture model below.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" onClick={() => navigate('/calibrate/active')}>
          Start calibration
        </button>
        <button className="btn-tertiary" onClick={useDefault}>
          Skip - use default model
        </button>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Your camera feed never leaves this device. Calibration stores five coordinate pairs describing the
        geometry of your head and shoulders - no image is captured or saved. <Link to="/settings/privacy" className="text-accent underline">How this works</Link>
      </p>
    </div>
  )
}
