import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CameraView } from '../components/CameraView'
import { PostureBadge } from '../components/PostureBadge'
import { StatCard } from '../components/StatCard'
import { useCamera } from '../hooks/useCamera'
import { usePoseLoop, type PoseFrame } from '../hooks/usePoseLoop'
import { loadCalibration } from '../lib/db'
import { hhmmss, mmss } from '../lib/time'
import { requestNotificationPermission, unlockAudio, notificationPermission } from '../lib/notify'
import { ABSENCE_GRACE_SECONDS, useSession } from '../store/session'
import { MODE_PRESETS, useSettings } from '../store/settings'
import type { CalibrationBaseline, Mode } from '../types'

export function Dashboard() {
  const navigate = useNavigate()
  const session = useSession()
  const settings = useSettings()
  const [baseline, setBaseline] = useState<CalibrationBaseline | null>(null)
  const [baselineLoaded, setBaselineLoaded] = useState(false)
  const [notifPerm, setNotifPerm] = useState(notificationPermission())

  const monitoring = session.phase === 'active' || session.phase === 'break_prompt' || session.phase === 'break'
  const { videoRef, status, error } = useCamera(monitoring)

  useEffect(() => {
    void loadCalibration().then((c) => {
      setBaseline(c ?? null)
      setBaselineLoaded(true)
    })
  }, [])

  // Feed every detected frame into the session engine. The engine only
  // accumulates here; thresholds are evaluated on the 1Hz heartbeat.
  const onFrame = useCallback((frame: PoseFrame) => {
    useSession.getState().ingest(frame.deviationPct, frame.present)
  }, [])

  const { frame, modelStatus, modelError } = usePoseLoop(
    videoRef,
    monitoring && status === 'ready',
    baseline,
    onFrame,
  )

  // The break prompt is a full screen of its own so it is hard to ignore.
  useEffect(() => {
    if (session.phase === 'break_prompt') navigate('/session/break')
    if (session.phase === 'break') navigate('/session/break/active')
  }, [session.phase, navigate])

  async function handleStart() {
    // Both of these need a user gesture, so they have to happen in this handler.
    await unlockAudio()
    if (settings.notificationStyles.includes('desktop')) {
      setNotifPerm(await requestNotificationPermission())
    }
    await session.start()
  }

  async function handleStop() {
    const id = await session.end()
    navigate(id ? `/session/summary?id=${id}` : '/data')
  }

  const intervalSeconds = settings.breakIntervalMin * 60
  const untilBreak = Math.max(0, intervalSeconds - session.sittingSeconds)
  const absent = session.absentSeconds >= ABSENCE_GRACE_SECONDS

  if (baselineLoaded && !baseline) {
    return (
      <div className="card mx-auto max-w-lg space-y-3 p-6 text-center">
        <h1 className="text-xl font-bold">Calibration needed</h1>
        <p className="text-sm text-muted">
          PostureGuard compares your posture against a baseline. Capture one to get started - it takes fifteen seconds.
        </p>
        <Link to="/calibrate" className="btn-primary">Calibrate now</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {monitoring ? 'Session in progress' : 'Ready when you are'}
          </h1>
          <p className="text-sm text-muted">
            {monitoring
              ? absent
                ? 'Timer paused - you are not in frame.'
                : `${MODE_PRESETS[settings.mode].label} Mode - break every ${settings.breakIntervalMin} min.`
              : 'Start a session to begin monitoring posture and sitting time.'}
          </p>
        </div>
        <PostureBadge
          state={absent && monitoring ? 'absent' : monitoring ? session.postureState : 'absent'}
          deviationPct={monitoring ? session.deviationPct : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          {monitoring ? (
            <CameraView
              videoRef={videoRef}
              landmarks={frame.landmarks}
              postureState={absent ? 'absent' : session.postureState}
              className="aspect-[4/3] w-full"
            />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center rounded-card border border-dashed border-line bg-surface text-center">
              <div className="space-y-2 px-6">
                <p className="text-sm font-medium text-muted">Camera is off</p>
                <p className="text-xs text-muted">
                  It turns on only while a session is running, and every frame is processed here on your device.
                </p>
              </div>
            </div>
          )}

          {monitoring && (status === 'denied' || status === 'unavailable' || status === 'insecure' || modelStatus === 'error') && (
            <p className="card border-danger/50 p-3 text-sm text-danger">{error ?? modelError}</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {monitoring ? (
              <button className="btn-danger" onClick={handleStop}>End session</button>
            ) : (
              <button className="btn-primary" onClick={handleStart}>Start session</button>
            )}

            <ModeToggle mode={settings.mode} onChange={settings.setMode} disabled={session.phase === 'break'} />
          </div>

          {monitoring && frame.fps > 0 && (
            <p className="text-xs text-muted">
              Detecting at {frame.fps.toFixed(0)} fps
              {baseline?.isDefault && ' - using the default baseline, calibrate for better accuracy'}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Session time"
              value={hhmmss(session.elapsedSeconds)}
              hint={monitoring ? 'since you started' : 'not running'}
            />
            <StatCard
              label="Next break in"
              value={monitoring ? mmss(untilBreak) : '--:--'}
              hint={session.snoozeSecondsRemaining > 0 ? `snoozed ${mmss(session.snoozeSecondsRemaining)}` : `every ${settings.breakIntervalMin} min`}
              tone={untilBreak < 120 && monitoring ? 'warn' : 'default'}
            />
            <StatCard
              label="Posture alerts"
              value={String(session.postureAlerts)}
              hint="this session"
              tone={session.postureAlerts > 0 ? 'warn' : 'default'}
            />
            <StatCard
              label="Breaks taken"
              value={`${session.breaksTaken}/${session.breaksPrompted}`}
              hint={session.breaksSnoozed > 0 ? `${session.breaksSnoozed} snoozed` : 'taken / prompted'}
              tone={session.breaksTaken > 0 ? 'accent' : 'default'}
            />
          </div>

          <div className="card space-y-2 p-4">
            <p className="label">Current deviation</p>
            <DeviationMeter value={monitoring ? session.deviationPct : 0} sensitivity={settings.sensitivity} />
            <p className="text-xs leading-relaxed text-muted">
              {monitoring
                ? session.sustainedSeconds > 0
                  ? `Above threshold for ${Math.round(session.sustainedSeconds)}s. An alert fires at ${MODE_PRESETS[settings.mode].postureAlertSeconds}s.`
                  : 'Measured against your calibrated baseline.'
                : 'Starts measuring when a session begins.'}
            </p>
          </div>

          {settings.notificationStyles.includes('desktop') && notifPerm === 'denied' && (
            <p className="card border-warn/40 p-3 text-xs text-warn">
              Desktop notifications are blocked for this site. In-app and audio alerts still work.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function ModeToggle({ mode, onChange, disabled }: { mode: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="inline-flex rounded-btn border border-line p-1" role="group" aria-label="Alert mode">
        {(Object.keys(MODE_PRESETS) as Mode[]).map((m) => (
          <button
            key={m}
            disabled={disabled}
            onClick={() => onChange(m)}
            title={MODE_PRESETS[m].blurb}
            className={`rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
              mode === m ? 'bg-accent text-[#04140A]' : 'text-muted hover:text-white'
            }`}
          >
            {MODE_PRESETS[m].label}
          </button>
        ))}
      </div>
      <p className="max-w-xs text-xs text-muted">{MODE_PRESETS[mode].blurb}</p>
    </div>
  )
}

function DeviationMeter({ value, sensitivity }: { value: number; sensitivity: 'low' | 'medium' | 'high' }) {
  const warning = sensitivity === 'low' ? 22 : sensitivity === 'high' ? 10 : 15
  const pct = Math.min(100, value)
  const color = value >= warning * 1.7 ? 'bg-danger' : value >= warning ? 'bg-warn' : 'bg-accent'

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="tabular text-2xl font-bold">{value.toFixed(0)}%</span>
        <span className="text-xs text-muted">threshold {warning}%</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-px bg-white/50" style={{ left: `${warning}%` }} />
      </div>
    </div>
  )
}
