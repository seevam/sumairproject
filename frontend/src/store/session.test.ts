import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The engine is pure timing logic; storage, sync and alert delivery are side
// effects we stub so a test can advance an hour of session time instantly.
vi.mock('../lib/db', () => ({
  saveSession: vi.fn(async () => undefined),
  appendEvent: vi.fn(async () => undefined),
  listSessions: vi.fn(async () => []),
}))
vi.mock('../lib/sync', () => ({ queueSync: vi.fn() }))
vi.mock('../lib/notify', () => ({ fireAlert: vi.fn() }))

import { fireAlert } from '../lib/notify'
import { listSessions, saveSession } from '../lib/db'
import {
  ABSENCE_GRACE_SECONDS,
  BREAK_MIN_SECONDS,
  CHECKPOINT_SECONDS,
  MAX_TICK_CREDIT_SECONDS,
  SNOOZE_MINUTES,
  recoverOrphanedSessions,
  useSession,
} from './session'
import { useSettings } from './settings'

/** Moves the mocked wall clock forward. */
function passTime(ms: number) {
  vi.setSystemTime(Date.now() + ms)
}

/**
 * Advance by `seconds` of observed session time: each second a frame arrives
 * and the heartbeat fires, as when the dashboard is open and the camera is live.
 */
function advance(seconds: number, deviationPct = 0, present = true) {
  for (let i = 0; i < seconds; i++) {
    passTime(1000)
    useSession.getState().ingest(deviationPct, present)
    useSession.getState().tick()
  }
}

/** Heartbeats with no camera frames, as when the detection loop has stalled. */
function tickWithoutFrames(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    passTime(1000)
    useSession.getState().tick()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
  vi.clearAllMocks()
  // reset() keeps the dev clock speed on purpose, so a test that changes it
  // would otherwise leak into every test after it.
  useSession.getState().setTimeScale(1)
  useSession.getState().setForcedDeviation(null)
  useSession.getState().setForcedAbsent(false)
  useSession.getState().reset()
  useSettings.setState({ mode: 'entertainment', participantId: 'P-TEST' })
  useSettings.getState().updateMode(
    {
      breakIntervalMin: 30,
      sensitivity: 'medium', // 15% warning threshold
      notificationStyles: ['visual', 'audio', 'desktop'],
      postureAlertSeconds: 60,
    },
    'entertainment',
  )
  await useSession.getState().start()
})

describe('posture alerts', () => {
  it('stays good while deviation is under the threshold', () => {
    advance(300, 8)
    const s = useSession.getState()
    expect(s.postureState).toBe('good')
    expect(s.postureAlerts).toBe(0)
  })

  it('warns immediately but waits out the dwell time before alerting', () => {
    advance(30, 25)
    expect(useSession.getState().postureState).toBe('warning')
    expect(useSession.getState().postureAlerts).toBe(0)

    advance(31, 25) // now past the 60s dwell for entertainment mode
    expect(useSession.getState().postureState).toBe('poor')
    expect(useSession.getState().postureAlerts).toBe(1)
  })

  it('respects the longer 90s dwell in study mode', () => {
    useSettings.setState({ mode: 'study' })
    useSettings.getState().updateMode({ postureAlertSeconds: 90, sensitivity: 'medium' }, 'study')
    advance(70, 25)
    expect(useSession.getState().postureAlerts).toBe(0)
    advance(25, 25)
    expect(useSession.getState().postureAlerts).toBe(1)
  })

  it('does not re-alert while posture stays bad', () => {
    advance(600, 30)
    expect(useSession.getState().postureAlerts).toBe(1)
  })

  it('re-arms only after posture recovers', () => {
    advance(70, 30)
    expect(useSession.getState().postureAlerts).toBe(1)
    advance(10, 2) // recover
    expect(useSession.getState().postureState).toBe('good')
    advance(70, 30) // slouch again
    expect(useSession.getState().postureAlerts).toBe(2)
  })

  it('resets the dwell timer when posture briefly recovers', () => {
    advance(50, 25)
    advance(5, 3) // dips back under the threshold
    expect(useSession.getState().sustainedSeconds).toBe(0)
    advance(50, 25)
    expect(useSession.getState().postureAlerts).toBe(0)
  })

  it('applies the sensitivity setting to the threshold', () => {
    useSettings.getState().updateMode({ sensitivity: 'low' }) // 22% warning
    advance(120, 18)
    expect(useSession.getState().postureAlerts).toBe(0)

    useSettings.getState().updateMode({ sensitivity: 'high' }) // 10% warning
    advance(70, 18)
    expect(useSession.getState().postureAlerts).toBe(1)
  })
})

describe('break reminders', () => {
  it('prompts once the configured sitting interval elapses', () => {
    advance(30 * 60 - 5)
    expect(useSession.getState().phase).toBe('active')
    advance(10)
    expect(useSession.getState().phase).toBe('break_prompt')
    expect(useSession.getState().breaksPrompted).toBe(1)
  })

  it('honours a 45-minute interval', () => {
    useSettings.getState().updateMode({ breakIntervalMin: 45 })
    advance(40 * 60)
    expect(useSession.getState().phase).toBe('active')
    advance(6 * 60)
    expect(useSession.getState().phase).toBe('break_prompt')
  })

  it('fires an alert on every channel the user enabled', () => {
    advance(30 * 60)
    expect(fireAlert).toHaveBeenCalledWith(expect.objectContaining({ tag: 'break', urgent: true }))
  })

  it('resets sitting time after a completed break', () => {
    advance(30 * 60)
    useSession.getState().startBreak()
    useSession.getState().endBreak()
    expect(useSession.getState().sittingSeconds).toBe(0)
    expect(useSession.getState().phase).toBe('active')
    expect(useSession.getState().breaksTaken).toBe(1)
  })
})

describe('snooze', () => {
  it('re-prompts after exactly the snooze window', () => {
    advance(30 * 60)
    useSession.getState().snoozeBreak()
    expect(useSession.getState().phase).toBe('active')
    expect(useSession.getState().breaksSnoozed).toBe(1)

    advance(SNOOZE_MINUTES * 60 - 5)
    expect(useSession.getState().phase).toBe('active')
    advance(10)
    expect(useSession.getState().phase).toBe('break_prompt')
    expect(useSession.getState().breaksPrompted).toBe(2)
  })

  it('is allowed only once per break', () => {
    advance(30 * 60)
    useSession.getState().snoozeBreak()
    advance(SNOOZE_MINUTES * 60 + 5)
    useSession.getState().snoozeBreak()
    expect(useSession.getState().breaksSnoozed).toBe(1)
    expect(useSession.getState().phase).toBe('break_prompt')
  })

  it('becomes available again after a break is actually taken', () => {
    advance(30 * 60)
    useSession.getState().snoozeBreak()
    advance(SNOOZE_MINUTES * 60 + 5)
    useSession.getState().startBreak()
    useSession.getState().endBreak()
    expect(useSession.getState().snoozeUsed).toBe(false)
  })
})

describe('presence', () => {
  it('keeps counting through a short absence', () => {
    advance(60)
    advance(ABSENCE_GRACE_SECONDS - 10, 0, false)
    const before = useSession.getState().sittingSeconds
    expect(before).toBeGreaterThan(100)
  })

  it('pauses the sitting timer once the user has been gone past the grace period', () => {
    advance(60)
    advance(ABSENCE_GRACE_SECONDS + 5, 0, false)
    const paused = useSession.getState().sittingSeconds
    advance(120, 0, false)
    expect(useSession.getState().sittingSeconds).toBe(paused)
    expect(useSession.getState().postureState).toBe('absent')
  })

  it('keeps the wall clock running while the user is away', () => {
    advance(60)
    const before = useSession.getState().elapsedSeconds
    advance(120, 0, false)
    expect(useSession.getState().elapsedSeconds).toBe(before + 120)
  })

  it('resumes counting when the user comes back', () => {
    advance(60)
    advance(ABSENCE_GRACE_SECONDS + 30, 0, false)
    const paused = useSession.getState().sittingSeconds
    advance(30)
    expect(useSession.getState().sittingSeconds).toBeGreaterThan(paused)
  })

  it('never fires a posture alert while the user is out of frame', () => {
    advance(300, 40, false)
    expect(useSession.getState().postureAlerts).toBe(0)
  })
})

describe('break completion', () => {
  it('auto-resumes when the user returns after a full break', () => {
    advance(30 * 60)
    useSession.getState().startBreak()
    advance(BREAK_MIN_SECONDS + 5, 0, false) // away from the desk
    expect(useSession.getState().phase).toBe('break')
    advance(1) // sits back down
    expect(useSession.getState().phase).toBe('active')
    expect(useSession.getState().sittingSeconds).toBe(0)
  })

  it('does not resume early if the user returns before the minimum', () => {
    advance(30 * 60)
    useSession.getState().startBreak()
    advance(60, 0, false)
    advance(5) // back too soon
    expect(useSession.getState().phase).toBe('break')
  })

  it('only credits time actually spent away', () => {
    advance(30 * 60)
    useSession.getState().startBreak()
    advance(60, 0, true) // still sitting there
    expect(useSession.getState().breakAbsenceSeconds).toBe(0)
    advance(60, 0, false)
    expect(useSession.getState().breakAbsenceSeconds).toBe(60)
  })
})

describe('session record', () => {
  it('averages deviation over time spent present', () => {
    advance(100, 10)
    advance(100, 20)
    const s = useSession.getState()
    expect(s.deviationSum / s.deviationSamples).toBeCloseTo(15, 0)
  })

  it('separates sitting time from wall-clock duration', () => {
    advance(60)
    useSession.getState().startBreak()
    advance(200, 0, false)
    useSession.getState().endBreak()
    const s = useSession.getState()
    expect(s.elapsedSeconds).toBe(260)
    expect(s.totalSittingSeconds).toBe(60)
  })

  it('returns to idle state after ending', async () => {
    advance(120, 5)
    const id = await useSession.getState().end()
    expect(id).toBeTruthy()
    expect(useSession.getState().phase).toBe('ended')
    expect(useSession.getState().sessionId).toBeNull()
  })
})

describe('dev overrides', () => {
  it('pins deviation to the forced value', () => {
    useSession.getState().setForcedDeviation(40)
    advance(70, 0)
    expect(useSession.getState().postureAlerts).toBe(1)
  })

  it('simulates the user being away regardless of detection', () => {
    useSession.getState().setForcedAbsent(true)
    advance(ABSENCE_GRACE_SECONDS + 60, 5, true)
    expect(useSession.getState().postureState).toBe('absent')
  })

  it('scales the clock so a 30-minute interval can be demoed in seconds', () => {
    useSession.getState().setTimeScale(60)
    advance(31) // 31 heartbeats x 60 = 31 minutes of session time
    expect(useSession.getState().phase).toBe('break_prompt')
  })
})

describe('wall-clock timing', () => {
  it('tracks real time when the heartbeat runs late', () => {
    // MediaPipe on the main thread was measured delaying the 1Hz interval by up
    // to 15%. Counting ticks would make every interval that much too long.
    for (let i = 0; i < 100; i++) {
      passTime(1150)
      useSession.getState().ingest(0, true)
      useSession.getState().tick()
    }
    expect(useSession.getState().elapsedSeconds).toBeCloseTo(115, 0)
    expect(useSession.getState().sittingSeconds).toBeCloseTo(115, 0)
  })

  it('still reaches the break on time when timers are throttled to once a minute', () => {
    // A background tab can see timers - and frames - once a minute.
    for (let i = 0; i < 31; i++) {
      passTime(60_000)
      useSession.getState().ingest(0, true)
      useSession.getState().tick()
    }
    expect(useSession.getState().phase).toBe('break_prompt')
  })

  it('does not count a laptop sleep as sitting', () => {
    advance(60)
    passTime(2 * 60 * 60 * 1000) // two hours asleep
    useSession.getState().ingest(0, true)
    useSession.getState().tick()

    const s = useSession.getState()
    expect(s.totalSittingSeconds).toBeLessThanOrEqual(60 + MAX_TICK_CREDIT_SECONDS)
    expect(s.phase).toBe('active')
  })
})

describe('when camera frames stop arriving', () => {
  it('does not fire a posture alert on a stale reading', () => {
    // The bug: one frame of slouching, then silence, used to produce an alert.
    passTime(1000)
    useSession.getState().ingest(30, true)
    tickWithoutFrames(300)
    expect(useSession.getState().postureAlerts).toBe(0)
  })

  it('pauses sitting time rather than guessing', () => {
    advance(60)
    const before = useSession.getState().sittingSeconds
    tickWithoutFrames(600)
    expect(useSession.getState().sittingSeconds).toBeLessThanOrEqual(before + 2)
  })

  it('does not mark the user absent just because it cannot see them', () => {
    advance(30)
    tickWithoutFrames(600)
    expect(useSession.getState().absentSeconds).toBe(0)
  })

  it('reports that it is not observing, so the UI can say so', () => {
    advance(10)
    expect(useSession.getState().observing).toBe(true)
    tickWithoutFrames(5)
    expect(useSession.getState().observing).toBe(false)
  })

  it('resumes where it left off once frames return', () => {
    advance(60)
    tickWithoutFrames(120)
    const paused = useSession.getState().sittingSeconds
    advance(60)
    expect(useSession.getState().sittingSeconds).toBeCloseTo(paused + 60, 0)
    expect(useSession.getState().observing).toBe(true)
  })

  it('keeps the wall-clock duration running throughout', () => {
    advance(60)
    tickWithoutFrames(120)
    expect(useSession.getState().elapsedSeconds).toBeCloseTo(180, 0)
  })
})

describe('checkpointing', () => {
  it('saves the session periodically, not only at start and end', () => {
    vi.mocked(saveSession).mockClear()
    advance(CHECKPOINT_SECONDS * 4)
    expect(vi.mocked(saveSession).mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('writes checkpoints as unfinished, with the duration so far', () => {
    vi.mocked(saveSession).mockClear()
    advance(CHECKPOINT_SECONDS + 1)
    const last = vi.mocked(saveSession).mock.calls.at(-1)![0]
    expect(last.endTime).toBeNull()
    expect(last.durationSeconds).toBeGreaterThanOrEqual(CHECKPOINT_SECONDS)
  })
})

describe('recoverOrphanedSessions', () => {
  const orphan = (patch = {}) => ({
    id: 's_orphan',
    participantId: 'P-TEST',
    age: null,
    behaviorType: null,
    activityType: null,
    startTime: Date.now() - 60 * 60 * 1000,
    endTime: null,
    durationSeconds: 1200,
    mode: 'study' as const,
    avgDeviationPct: 10,
    deviationSamples: 1200,
    postureAlerts: 1,
    breaksPrompted: 0,
    breaksTaken: 0,
    breaksSnoozed: 0,
    sittingSeconds: 1200,
    synced: true,
    ...patch,
  })

  it('closes a session a crashed page left open, at its last checkpoint', async () => {
    await useSession.getState().end()
    const record = orphan()
    vi.mocked(listSessions).mockResolvedValueOnce([record])
    vi.mocked(saveSession).mockClear()

    expect(await recoverOrphanedSessions()).toBe(1)
    const saved = vi.mocked(saveSession).mock.calls[0][0]
    expect(saved.endTime).toBe(record.startTime + 1200 * 1000)
    expect(saved.synced).toBe(false) // so it is pushed to the server too
  })

  it('leaves a session another tab is still checkpointing alone', async () => {
    await useSession.getState().end()
    vi.mocked(listSessions).mockResolvedValueOnce([
      orphan({ startTime: Date.now() - 1000 * 1000, durationSeconds: 995 }),
    ])
    vi.mocked(saveSession).mockClear()
    expect(await recoverOrphanedSessions()).toBe(0)
    expect(saveSession).not.toHaveBeenCalled()
  })

  it('never touches the session running in this tab', async () => {
    const live = useSession.getState().sessionId!
    vi.mocked(listSessions).mockResolvedValueOnce([orphan({ id: live })])
    expect(await recoverOrphanedSessions()).toBe(0)
  })

  it('ignores sessions that already ended', async () => {
    vi.mocked(listSessions).mockResolvedValueOnce([orphan({ endTime: Date.now() })])
    expect(await recoverOrphanedSessions()).toBe(0)
  })
})
