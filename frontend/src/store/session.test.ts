import { beforeEach, describe, expect, it, vi } from 'vitest'

// The engine is pure timing logic; storage, sync and alert delivery are side
// effects we stub so a test can advance an hour of session time instantly.
vi.mock('../lib/db', () => ({
  saveSession: vi.fn(async () => undefined),
  appendEvent: vi.fn(async () => undefined),
}))
vi.mock('../lib/sync', () => ({ queueSync: vi.fn() }))
vi.mock('../lib/notify', () => ({ fireAlert: vi.fn() }))

import { fireAlert } from '../lib/notify'
import { ABSENCE_GRACE_SECONDS, BREAK_MIN_SECONDS, SNOOZE_MINUTES, useSession } from './session'
import { useSettings } from './settings'

/** Advance the engine by `seconds` of session time, one heartbeat at a time. */
function advance(seconds: number, deviationPct = 0, present = true) {
  for (let i = 0; i < seconds; i++) {
    useSession.getState().ingest(deviationPct, present)
    useSession.getState().tick()
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
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
