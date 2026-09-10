import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { humanMinutes } from '../lib/time'
import { SNOOZE_MINUTES, useSession } from '../store/session'

export function BreakPrompt() {
  const navigate = useNavigate()
  const { phase, sittingSeconds, snoozeUsed, startBreak, snoozeBreak } = useSession()

  // Reached directly (refresh, bookmark) with no prompt pending.
  useEffect(() => {
    if (phase !== 'break_prompt') navigate('/dashboard', { replace: true })
  }, [phase, navigate])

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8 text-center">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-warn/15 text-4xl">
        <span aria-hidden>&#9201;</span>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Time for a break</h1>
        <p className="text-muted">
          You have been sitting for {humanMinutes(sittingSeconds)}. A short movement break now offsets most of
          the cardiovascular cost of that sitting time.
        </p>
      </div>

      <div className="card space-y-3 p-5 text-left">
        <p className="label">What counts as a break</p>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>Stand up and step out of the camera frame.</li>
          <li>Move for at least three minutes.</li>
          <li>The session resumes automatically when you sit back down.</li>
        </ul>
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
        <button
          className="btn-primary"
          onClick={() => {
            startBreak()
            navigate('/session/break/active')
          }}
        >
          Start break
        </button>
        <button className="btn-tertiary" onClick={snoozeBreak} disabled={snoozeUsed}>
          {snoozeUsed ? 'Already snoozed once' : `Remind me in ${SNOOZE_MINUTES} min`}
        </button>
      </div>

      {snoozeUsed && (
        <p className="text-xs text-muted">Snooze is limited to once per break, by design.</p>
      )}
    </div>
  )
}
