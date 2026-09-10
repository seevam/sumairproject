import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { mmss } from '../lib/time'
import { BREAK_MIN_SECONDS, useSession } from '../store/session'

/** Suggested movements (US-21). Short, doable beside a desk, no equipment. */
const EXERCISES = [
  { name: 'Calf raises', detail: '20 slow reps - restores blood flow in the legs' },
  { name: 'Walk to another room', detail: 'Even 60 seconds of walking counts' },
  { name: 'Shoulder rolls', detail: '10 backwards - opens up the chest after slouching' },
  { name: 'Look out a window', detail: '20 seconds at distance rests your eyes' },
]

export function BreakActive() {
  const navigate = useNavigate()
  const { phase, breakSeconds, breakAbsenceSeconds, present, endBreak } = useSession()

  // Covers both a direct visit with no break running and the auto-resume that
  // fires when the user returns after a full break.
  useEffect(() => {
    if (phase !== 'break') navigate('/dashboard', { replace: true })
  }, [phase, navigate])

  const remaining = Math.max(0, BREAK_MIN_SECONDS - breakAbsenceSeconds)
  const progress = Math.min(1, breakAbsenceSeconds / BREAK_MIN_SECONDS)
  const complete = remaining === 0

  // Circumference of the r=54 ring below.
  const CIRCUMFERENCE = 2 * Math.PI * 54

  return (
    <div className="mx-auto max-w-lg space-y-6 py-6 text-center">
      <div className="flex items-center justify-center gap-2">
        <span className="rec-dot h-2 w-2 rounded-full bg-warn" />
        <span className="text-sm font-semibold uppercase tracking-wider text-warn">Break in progress</span>
      </div>

      <div className="relative mx-auto h-40 w-40">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#30363D" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke={complete ? '#1DB954' : '#F0A500'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <p className="tabular text-3xl font-bold">{complete ? 'Done' : mmss(remaining)}</p>
            <p className="text-xs text-muted">{complete ? 'break complete' : 'remaining'}</p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <p className="font-semibold">
          {present ? 'Step away from the desk' : 'Nice - keep moving'}
        </p>
        <p className="text-sm text-muted">
          {present
            ? 'The break timer only counts while you are out of frame.'
            : complete
              ? 'Sit back down and the session will resume on its own.'
              : `Elapsed: ${mmss(breakSeconds)}`}
        </p>
      </div>

      <div className="card divide-y divide-line text-left">
        {EXERCISES.map((ex) => (
          <div key={ex.name} className="px-4 py-3">
            <p className="text-sm font-medium">{ex.name}</p>
            <p className="text-xs text-muted">{ex.detail}</p>
          </div>
        ))}
      </div>

      <button
        className={complete ? 'btn-primary' : 'btn-secondary'}
        onClick={endBreak}
      >
        {complete ? 'Resume session' : 'End break early'}
      </button>
    </div>
  )
}
