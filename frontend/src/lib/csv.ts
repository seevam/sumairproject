import type { SessionEvent, SessionRecord } from '../types'

/** RFC 4180 quoting: wrap in quotes and double any embedded quote. */
function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toRows(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

function isoDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isoTime(ts: number): string {
  return new Date(ts).toISOString()
}

export function complianceRate(session: SessionRecord): number {
  if (session.breaksPrompted === 0) return 100
  return Math.round((session.breaksTaken / session.breaksPrompted) * 1000) / 10
}

/**
 * One row per session, exactly the columns named in PRD 7.5 so the file drops
 * straight into the paper's Results section.
 */
export const SESSION_CSV_HEADER = [
  'participant_id',
  'date',
  'session_start',
  'session_duration_min',
  'avg_posture_deviation_pct',
  'posture_alerts_triggered',
  'breaks_prompted',
  'breaks_taken',
  'breaks_snoozed',
  'compliance_rate_pct',
  'mode',
]

export function sessionsToCsv(sessions: SessionRecord[]): string {
  const rows: unknown[][] = [SESSION_CSV_HEADER]
  for (const s of sessions) {
    rows.push([
      s.participantId,
      isoDate(s.startTime),
      isoTime(s.startTime),
      Math.round((s.durationSeconds / 60) * 10) / 10,
      Math.round(s.avgDeviationPct * 10) / 10,
      s.postureAlerts,
      s.breaksPrompted,
      s.breaksTaken,
      s.breaksSnoozed,
      complianceRate(s),
      s.mode,
    ])
  }
  return toRows(rows)
}

/**
 * Event-level export. The session CSV is the headline dataset; this one lets the
 * paper report within-session timing (e.g. time-to-correction after an alert).
 */
export function eventsToCsv(events: SessionEvent[], sessions: SessionRecord[]): string {
  const participantById = new Map(sessions.map((s) => [s.id, s.participantId]))
  const startById = new Map(sessions.map((s) => [s.id, s.startTime]))

  const rows: unknown[][] = [
    ['participant_id', 'session_id', 'event_type', 'timestamp', 'seconds_into_session', 'deviation_pct', 'duration_seconds'],
  ]
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const start = startById.get(e.sessionId)
    rows.push([
      participantById.get(e.sessionId) ?? '',
      e.sessionId,
      e.type,
      isoTime(e.timestamp),
      start ? Math.round((e.timestamp - start) / 1000) : '',
      e.deviationPct !== undefined ? Math.round(e.deviationPct * 10) / 10 : '',
      e.durationSeconds ?? '',
    ])
  }
  return toRows(rows)
}

export function downloadCsv(filename: string, contents: string): void {
  // Prefix a BOM so Excel opens the file as UTF-8 rather than mangling it.
  const blob = new Blob([`﻿${contents}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
