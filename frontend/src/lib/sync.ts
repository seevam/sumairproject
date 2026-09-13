import type { SessionRecord } from '../types'
import { listSessions, saveSession, listEvents } from './db'

/**
 * Best-effort mirror of local data to the Flask backend.
 *
 * Nothing here is on the critical path: if the backend is unset, asleep or
 * unreachable, sessions stay marked unsynced locally and are retried later.
 * Only aggregates and event timestamps are sent - never landmarks, never frames.
 */

/**
 * Where the backend lives, as a prefix to put in front of "/api/...".
 *
 * Three shapes are supported:
 *   ""                        sync is off, nothing is ever transmitted
 *   "same-origin"             the backend ships with this deployment (Vercel
 *                             routes /api to the Python service on this domain)
 *   "https://host"            a separately hosted backend
 *
 * "same-origin" resolves to the empty prefix, so requests go to a relative
 * "/api/..." path and no CORS preflight is involved.
 */
export const SAME_ORIGIN = 'same-origin'

function configured(): string {
  // Read at call time so a change in Settings takes effect without a reload.
  try {
    const raw = localStorage.getItem('postureguard:settings')
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { apiBaseUrl?: string } }
      const url = parsed.state?.apiBaseUrl?.trim()
      if (url) return url
    }
  } catch {
    /* fall through to the build-time default */
  }
  return (import.meta.env.VITE_API_BASE_URL ?? '').trim()
}

function baseUrl(): string {
  const value = configured()
  if (!value) return ''
  if (value === SAME_ORIGIN) return ''
  // A bare "/" or "/api" also means this origin.
  if (value.startsWith('/')) return value.replace(/\/+$/, '').replace(/\/api$/, '')
  return value.replace(/\/+$/, '')
}

export function syncEnabled(): boolean {
  return configured().length > 0
}

/**
 * Supplies a bearer token for sync requests.
 *
 * Registered by the app at startup when auth is available. Guest builds never
 * set it, so sync stays anonymous and no Clerk code is involved.
 */
let tokenProvider: (() => Promise<string | null>) | null = null

export function setAuthTokenProvider(provider: (() => Promise<string | null>) | null): void {
  tokenProvider = provider
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!tokenProvider) return {}
  try {
    const token = await tokenProvider()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

/**
 * Probe for a backend on this origin. Used by Settings to offer one-click
 * enabling when the deployment includes the Python service, rather than
 * silently switching sync on for everyone.
 */
export async function detectSameOriginBackend(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    const body = (await res.json()) as { status?: string }
    return body.status === 'ok'
  } catch {
    return false
  }
}

async function postSession(record: SessionRecord): Promise<boolean> {
  // Guard on whether sync is configured, not on the resolved prefix: a
  // same-origin backend correctly resolves to an empty prefix.
  if (!syncEnabled()) return false
  const url = baseUrl()
  try {
    const events = await listEvents(record.id)
    const res = await fetch(`${url}/api/session/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
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
