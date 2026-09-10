import { openDB, type IDBPDatabase } from 'idb'
import type { CalibrationBaseline, SessionEvent, SessionRecord } from '../types'

/**
 * Local-first store. Every session and event is written here first and is the
 * source of truth; the backend is a mirror. A participant whose laptop is
 * offline, or whose free-tier backend is cold, still produces a complete
 * dataset for the pilot study.
 */

const DB_NAME = 'postureguard'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const sessions = database.createObjectStore('sessions', { keyPath: 'id' })
        sessions.createIndex('startTime', 'startTime')
        sessions.createIndex('synced', 'synced')

        const events = database.createObjectStore('events', {
          keyPath: 'id',
          autoIncrement: true,
        })
        events.createIndex('sessionId', 'sessionId')

        database.createObjectStore('calibration')
      },
    })
  }
  return dbPromise
}

export async function saveSession(session: SessionRecord): Promise<void> {
  await (await db()).put('sessions', session)
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return (await db()).get('sessions', id)
}

/** Newest first, which is the order every screen wants to display. */
export async function listSessions(): Promise<SessionRecord[]> {
  const all: SessionRecord[] = await (await db()).getAllFromIndex('sessions', 'startTime')
  return all.reverse()
}

export async function appendEvent(event: SessionEvent): Promise<void> {
  await (await db()).add('events', event)
}

export async function listEvents(sessionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = await (await db()).getAllFromIndex('events', 'sessionId', sessionId)
  return events.sort((a, b) => a.timestamp - b.timestamp)
}

export async function listAllEvents(): Promise<SessionEvent[]> {
  return (await db()).getAll('events')
}

export async function saveCalibration(baseline: CalibrationBaseline): Promise<void> {
  await (await db()).put('calibration', baseline, 'current')
}

export async function loadCalibration(): Promise<CalibrationBaseline | undefined> {
  return (await db()).get('calibration', 'current')
}

export async function clearCalibration(): Promise<void> {
  await (await db()).delete('calibration', 'current')
}

/** Backs US-30's "delete all my data" guarantee. */
export async function deleteAllData(): Promise<void> {
  const database = await db()
  await Promise.all([
    database.clear('sessions'),
    database.clear('events'),
    database.clear('calibration'),
  ])
}
