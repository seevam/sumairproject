import type { SessionRecord } from '../types'
import { listSessions, saveSession, listEvents } from './db'

/**
 * Best-effort mirror of local data to the Flask backend.
 *
 * Nothing here is on the critical path: if the backend is unset, asleep or
 * unreachable, sessions stay marked unsynced locally and are retried later.
 * Only aggregates and event timestamps are sent - never landmarks, never frames.
 */

function baseUrl(): string {
  // Read at call time so a change in Settings takes effect without a reload.
  try {
    const raw = localStorage.getItem('postureguard:settings')
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { apiBaseUrl?: string } }
      const url = parsed.state?.apiBaseUrl?.trim()
      if (url) return url.replace(/\/$/, '')
    }
  } catch {
    /* fall through to the build-time default */
  }
  return (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
}

export function syncEnabled(): boolean {
  return baseUrl().length > 0
}

async function postSession(record: SessionRecord): Promise<boolean> {
  const url = baseUrl()
  if (!url) return false
  try {
    const events = await listEvents(record.id)
    const res = await fetch(`${url}/api/session/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: record, events }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Fire-and-forget push for a session that just ended. */
export function queueSync(record: SessionRecord): void {
  if (!syncEnabled()) return
  void postSession(record).then(async (ok) => {
    if (ok) await saveSession({ ...record, synced: true })
  })
}

/** Retries everything still marked unsynced. Called on app start and from Settings. */
export async function syncPending(): Promise<{ attempted: number; synced: number }> {
  if (!syncEnabled()) return { attempted: 0, synced: 0 }
  const pending = (await listSessions()).filter((s) => !s.synced && s.endTime !== null)
  let synced = 0
  for (const record of pending) {
    if (await postSession(record)) {
      await saveSession({ ...record, synced: true })
      synced += 1
    }
  }
  return { attempted: pending.length, synced }
}
