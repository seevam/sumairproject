/** Formatting helpers for the many timers on screen. */

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function hhmmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  if (h === 0) return mmss(s)
  return `${String(h).padStart(2, '0')}:${mmss(s % 3600)}`
}

export function humanMinutes(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60)
  if (m < 1) return 'less than a minute'
  if (m === 1) return '1 minute'
  if (m < 60) return `${m} minutes`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

export function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function shortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
