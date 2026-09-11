// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({
  listSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => undefined),
  listEvents: vi.fn(async () => []),
}))

import { SAME_ORIGIN, detectSameOriginBackend, syncEnabled } from './sync'

/** The sync layer reads the persisted settings blob directly, so shape it here. */
function setApiBaseUrl(value: string | undefined) {
  if (value === undefined) {
    localStorage.removeItem('postureguard:settings')
    return
  }
  localStorage.setItem('postureguard:settings', JSON.stringify({ state: { apiBaseUrl: value } }))
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  localStorage.clear()
})

describe('syncEnabled', () => {
  it('is off by default, so a fresh install transmits nothing', () => {
    setApiBaseUrl(undefined)
    expect(syncEnabled()).toBe(false)
  })

  it('stays off for a blank or whitespace-only setting', () => {
    setApiBaseUrl('')
    expect(syncEnabled()).toBe(false)
    setApiBaseUrl('   ')
    expect(syncEnabled()).toBe(false)
  })

  it('turns on for the same-origin sentinel', () => {
    setApiBaseUrl(SAME_ORIGIN)
    expect(syncEnabled()).toBe(true)
  })

  it('turns on for an absolute URL', () => {
    setApiBaseUrl('https://api.example.com')
    expect(syncEnabled()).toBe(true)
  })

  it('survives a corrupted settings blob without throwing', () => {
    localStorage.setItem('postureguard:settings', '{not json')
    expect(() => syncEnabled()).not.toThrow()
    expect(syncEnabled()).toBe(false)
  })
})

describe('request targets', () => {
  /** Capture the URL the sync layer would actually call. */
  async function urlFor(setting: string): Promise<string> {
    setApiBaseUrl(setting)
    const fetchMock = vi.fn(async (_url: string) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { queueSync } = await import('./sync')
    queueSync({
      id: 's1', participantId: 'P', startTime: 1, endTime: 2, durationSeconds: 1,
      mode: 'study', avgDeviationPct: 0, deviationSamples: 0, postureAlerts: 0,
      breaksPrompted: 0, breaksTaken: 0, breaksSnoozed: 0, sittingSeconds: 0, synced: false,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    return String(fetchMock.mock.calls[0]![0])
  }

  it('uses a relative path for the same-origin sentinel, avoiding CORS entirely', async () => {
    expect(await urlFor(SAME_ORIGIN)).toBe('/api/session/sync')
  })

  it('treats a bare "/" as this origin', async () => {
    expect(await urlFor('/')).toBe('/api/session/sync')
  })

  it('does not double up the prefix when the setting already ends in /api', async () => {
    expect(await urlFor('/api')).toBe('/api/session/sync')
  })

  it('keeps an absolute backend URL intact', async () => {
    expect(await urlFor('https://api.example.com')).toBe('https://api.example.com/api/session/sync')
  })

  it('strips a trailing slash from an absolute URL', async () => {
    expect(await urlFor('https://api.example.com/')).toBe('https://api.example.com/api/session/sync')
  })
})

describe('detectSameOriginBackend', () => {
  it('reports true when /api/health answers ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })))
    expect(await detectSameOriginBackend()).toBe(true)
  })

  it('reports false when the route is served by the SPA fallback instead', async () => {
    // A missing backend on a static host returns index.html, not JSON.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200 })))
    expect(await detectSameOriginBackend()).toBe(false)
  })

  it('reports false on a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await detectSameOriginBackend()).toBe(false)
  })

  it('reports false when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await detectSameOriginBackend()).toBe(false)
  })
})
