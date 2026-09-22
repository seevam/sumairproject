import { describe, expect, it } from 'vitest'
import { SESSION_CSV_HEADER, complianceRate, sessionsToCsv } from './csv'
import type { SessionRecord } from '../types'

function session(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    participantId: 'P-ABC123',
    age: 16,
    behaviorType: 'student',
    activityType: 'studying',
    startTime: Date.UTC(2026, 8, 14, 10, 0, 0),
    endTime: Date.UTC(2026, 8, 14, 11, 0, 0),
    durationSeconds: 3600,
    mode: 'study',
    avgDeviationPct: 12.34,
    deviationSamples: 3400,
    postureAlerts: 3,
    breaksPrompted: 2,
    breaksTaken: 1,
    breaksSnoozed: 1,
    sittingSeconds: 3400,
    synced: false,
    ...patch,
  }
}

describe('complianceRate', () => {
  it('is the share of prompts the user actually acted on', () => {
    expect(complianceRate(session({ breaksPrompted: 4, breaksTaken: 3 }))).toBe(75)
  })

  it('reports 100% when no break was ever due, rather than dividing by zero', () => {
    expect(complianceRate(session({ breaksPrompted: 0, breaksTaken: 0 }))).toBe(100)
  })
})

describe('sessionsToCsv', () => {
  it('emits the column set the pilot analysis expects', () => {
    const [header] = sessionsToCsv([session()]).split('\r\n')
    expect(header.split(',')).toEqual(SESSION_CSV_HEADER)
  })

  it('writes duration in minutes and rounds deviation to one decimal', () => {
    const row = sessionsToCsv([session()]).split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('session_duration_min')).toBe('60') // 3600s -> 60 min
    expect(col('avg_posture_deviation_pct')).toBe('12.3')
    expect(col('compliance_rate_pct')).toBe('50') // 1 of 2 breaks taken
  })

  it('quotes any field containing a comma so the row cannot split', () => {
    const csv = sessionsToCsv([session({ participantId: 'P-1,X' })])
    expect(csv).toContain('"P-1,X"')
    expect(csv.split('\r\n')[1].split(',').length).toBe(SESSION_CSV_HEADER.length + 1)
  })

  it('emits a header even with no sessions', () => {
    expect(sessionsToCsv([])).toBe(SESSION_CSV_HEADER.join(','))
  })

  it('carries the profile so the dataset can be grouped without a second file', () => {
    const row = sessionsToCsv([session()]).split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('age')).toBe('16')
    expect(col('behavior_type')).toBe('student')
    expect(col('preferred_activity')).toBe('studying')
  })

  it('writes empty cells rather than "null" for an unset profile', () => {
    const row = sessionsToCsv([session({ age: null, behaviorType: null, activityType: null })])
      .split('\r\n')[1]
      .split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('age')).toBe('')
    expect(col('behavior_type')).toBe('')
  })
})
