import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatCard } from '../components/StatCard'
import { listAllEvents, listSessions } from '../lib/db'
import { complianceRate, downloadCsv, eventsToCsv, sessionsToCsv } from '../lib/csv'
import { humanMinutes, shortDate, shortTime } from '../lib/time'
import { syncEnabled, syncPending } from '../lib/sync'
import type { SessionRecord } from '../types'

type Period = 'week' | 'month' | 'all'

const WINDOW_DAYS: Record<Period, number> = { week: 7, month: 30, all: 36500 }

export function Data() {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [period, setPeriod] = useState<Period>('week')
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  useEffect(() => {
    void listSessions().then(setSessions)
  }, [])

  const filtered = useMemo(() => {
    const cutoff = Date.now() - WINDOW_DAYS[period] * 86_400_000
    return sessions.filter((s) => s.startTime >= cutoff && s.endTime !== null)
  }, [sessions, period])

  const totals = useMemo(() => {
    const sittingSeconds = filtered.reduce((a, s) => a + s.sittingSeconds, 0)
    const alerts = filtered.reduce((a, s) => a + s.postureAlerts, 0)
    const prompted = filtered.reduce((a, s) => a + s.breaksPrompted, 0)
    const taken = filtered.reduce((a, s) => a + s.breaksTaken, 0)
    // Weight each session's mean deviation by how long it ran, so a two-minute
    // session does not count as much as an hour-long one.
    const weighted = filtered.reduce((a, s) => a + s.avgDeviationPct * s.sittingSeconds, 0)
    return {
      sittingSeconds,
      alerts,
      compliance: prompted > 0 ? Math.round((taken / prompted) * 100) : null,
      avgDeviation: sittingSeconds > 0 ? weighted / sittingSeconds : 0,
    }
  }, [filtered])

  const daily = useMemo(() => buildDailySeries(filtered, Math.min(WINDOW_DAYS[period], 30)), [filtered, period])

  async function exportSessions() {
    const all = await listSessions()
    downloadCsv(`postureguard_sessions_${new Date().toISOString().slice(0, 10)}.csv`, sessionsToCsv(all.filter((s) => s.endTime !== null)))
  }

  async function exportEvents() {
    const [all, events] = await Promise.all([listSessions(), listAllEvents()])
    downloadCsv(`postureguard_events_${new Date().toISOString().slice(0, 10)}.csv`, eventsToCsv(events, all))
  }

  async function runSync() {
    setSyncMsg('Syncing...')
    const { attempted, synced } = await syncPending()
    setSyncMsg(attempted === 0 ? 'Nothing pending.' : `Synced ${synced} of ${attempted}.`)
    setSessions(await listSessions())
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your data</h1>
          <p className="text-sm text-muted">Stored on this device. Export any time.</p>
        </div>
        <div className="inline-flex rounded-btn border border-line p-1">
          {(['week', 'month', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-[5px] px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                period === p ? 'bg-white/10 text-white' : 'text-muted hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Sessions" value={String(filtered.length)} hint={`past ${period}`} />
        <StatCard label="Sitting time" value={humanMinutes(totals.sittingSeconds)} hint="monitored at desk" />
        <StatCard
          label="Avg deviation"
          value={`${totals.avgDeviation.toFixed(1)}%`}
          hint={`${totals.alerts} alerts`}
          tone={totals.avgDeviation >= 15 ? 'warn' : 'accent'}
        />
        <StatCard
          label="Break compliance"
          value={totals.compliance === null ? '--' : `${totals.compliance}%`}
          hint="taken / prompted"
          tone={totals.compliance !== null && totals.compliance < 50 ? 'warn' : 'accent'}
        />
      </div>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">Sitting time per day</h2>
        <DailyChart data={daily} />
      </section>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Sessions</h2>
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No completed sessions yet. <Link to="/dashboard" className="text-accent underline">Start one</Link>.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-24 shrink-0 text-muted">
                  {shortDate(s.startTime)} {shortTime(s.startTime)}
                </span>
                <span className="tabular w-20">{humanMinutes(s.sittingSeconds)}</span>
                <span className="tabular w-24 text-muted">{s.avgDeviationPct.toFixed(1)}% dev</span>
                <span className="tabular w-20 text-muted">{s.postureAlerts} alerts</span>
                <span className="tabular w-24 text-muted">{complianceRate(s)}% breaks</span>
                <Link to={`/session/summary?id=${s.id}`} className="ml-auto text-accent hover:underline">
                  Details
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Export for research</h2>
        <p className="text-xs leading-relaxed text-muted">
          The session file has one row per session with the columns the pilot study analysis expects. The event
          file is the within-session timeline, for time-to-correction analysis.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={exportSessions}>Export sessions CSV</button>
          <button className="btn-secondary" onClick={exportEvents}>Export events CSV</button>
          {syncEnabled() && (
            <button className="btn-tertiary" onClick={runSync}>Sync to server</button>
          )}
        </div>
        {syncMsg && <p className="text-xs text-muted">{syncMsg}</p>}
      </section>
    </div>
  )
}

interface DayBucket {
  date: string
  label: string
  minutes: number
}

function buildDailySeries(sessions: SessionRecord[], days: number): DayBucket[] {
  const buckets = new Map<string, DayBucket>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, {
      date: key,
      label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      minutes: 0,
    })
  }

  for (const s of sessions) {
    const key = new Date(s.startTime).toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (bucket) bucket.minutes += s.sittingSeconds / 60
  }

  return [...buckets.values()]
}

function DailyChart({ data }: { data: DayBucket[] }) {
  const max = Math.max(60, ...data.map((d) => d.minutes))

  return (
    <div className="mt-4">
      <div className="flex h-32 items-end gap-1">
        {data.map((d) => (
          <div key={d.date} className="group relative flex-1">
            <div
              className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
              style={{ height: `${Math.max(2, (d.minutes / max) * 128)}px` }}
            />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-1.5 py-0.5 text-[10px] text-white group-hover:block">
              {Math.round(d.minutes)} min
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 text-center text-[10px] text-muted">
        {data.map((d) => (
          <span key={d.date} className="flex-1">{data.length <= 10 ? d.label : ''}</span>
        ))}
      </div>
    </div>
  )
}
