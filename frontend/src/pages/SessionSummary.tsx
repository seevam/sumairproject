import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { StatCard } from '../components/StatCard'
import { getSession, listEvents } from '../lib/db'
import { complianceRate } from '../lib/csv'
import { hhmmss, humanMinutes, shortTime } from '../lib/time'
import type { SessionEvent, SessionRecord } from '../types'

const EVENT_LABELS: Partial<Record<SessionEvent['type'], string>> = {
  session_start: 'Session started',
  session_end: 'Session ended',
  posture_alert: 'Posture alert',
  posture_recovered: 'Posture corrected',
  break_prompt: 'Break reminder',
  break_start: 'Break started',
  break_end: 'Break ended',
  break_snooze: 'Break snoozed',
  user_absent: 'Left the desk',
  user_present: 'Returned',
}

export function SessionSummary() {
  const [params] = useSearchParams()
  const id = params.get('id')
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])

  useEffect(() => {
    if (!id) return
    void getSession(id).then((s) => setSession(s ?? null))
    void listEvents(id).then(setEvents)
  }, [id])

  if (!session) {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center">
        <p className="text-muted">No session found.</p>
        <Link to="/dashboard" className="btn-secondary mt-4">Back to dashboard</Link>
      </div>
    )
  }

  const compliance = complianceRate(session)
  // posture_warning fires often and would drown the timeline; alerts are the signal.
  const timeline = events.filter((e) => e.type !== 'posture_warning')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Session summary</h1>
        <p className="text-sm text-muted">
          {shortTime(session.startTime)}
          {session.endTime ? ` - ${shortTime(session.endTime)}` : ''} - {session.mode} mode
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Duration" value={hhmmss(session.durationSeconds)} hint="wall clock" />
        <StatCard
          label="Sitting time"
          value={humanMinutes(session.sittingSeconds)}
          hint="excludes breaks and time away"
        />
        <StatCard
          label="Posture alerts"
          value={String(session.postureAlerts)}
          tone={session.postureAlerts > 0 ? 'warn' : 'accent'}
          hint={`avg deviation ${session.avgDeviationPct.toFixed(1)}%`}
        />
        <StatCard
          label="Break compliance"
          value={`${compliance}%`}
          tone={compliance >= 70 ? 'accent' : compliance >= 40 ? 'warn' : 'danger'}
          hint={`${session.breaksTaken} taken, ${session.breaksSnoozed} snoozed`}
        />
      </div>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Timeline</h2>
        <ol className="divide-y divide-line">
          {timeline.map((e, i) => (
            <li key={e.id ?? i} className="flex items-baseline gap-4 px-4 py-2.5 text-sm">
              <span className="tabular w-16 shrink-0 text-xs text-muted">
                {hhmmss((e.timestamp - session.startTime) / 1000)}
              </span>
              <span className="flex-1">{EVENT_LABELS[e.type] ?? e.type}</span>
              {e.deviationPct !== undefined && (
                <span className="tabular text-xs text-muted">{e.deviationPct.toFixed(0)}%</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link to="/dashboard" className="btn-primary">Start a new session</Link>
        <Link to="/data" className="btn-secondary">View all sessions</Link>
      </div>
    </div>
  )
}
