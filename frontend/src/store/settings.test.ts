// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { BEHAVIOR_DEFAULT_MODE, MODE_DEFAULTS, parseAge, useSettings } from './settings'

/** Reset to a pristine store between tests, since persist shares localStorage. */
function reset() {
  localStorage.clear()
  useSettings.setState({
    mode: 'study',
    modes: {
      study: { ...MODE_DEFAULTS.study, notificationStyles: [...MODE_DEFAULTS.study.notificationStyles] },
      entertainment: {
        ...MODE_DEFAULTS.entertainment,
        notificationStyles: [...MODE_DEFAULTS.entertainment.notificationStyles],
      },
    },
    profile: { age: null, behaviorType: null, preferredActivity: null },
  })
}

beforeEach(reset)

describe('per-mode settings', () => {
  it('starts each mode from its own preset', () => {
    const s = useSettings.getState()
    expect(s.modes.study.breakIntervalMin).toBe(45)
    expect(s.modes.entertainment.breakIntervalMin).toBe(30)
    expect(s.modes.study.postureAlertSeconds).toBe(90)
    expect(s.modes.entertainment.postureAlertSeconds).toBe(60)
  })

  it('active() follows the selected mode', () => {
    expect(useSettings.getState().active().breakIntervalMin).toBe(45)
    useSettings.getState().setMode('entertainment')
    expect(useSettings.getState().active().breakIntervalMin).toBe(30)
  })

  it('edits one mode without touching the other', () => {
    useSettings.getState().updateMode({ breakIntervalMin: 60 }, 'study')
    expect(useSettings.getState().modes.study.breakIntervalMin).toBe(60)
    expect(useSettings.getState().modes.entertainment.breakIntervalMin).toBe(30)
  })

  it('defaults updateMode to the mode currently in use', () => {
    useSettings.getState().setMode('entertainment')
    useSettings.getState().updateMode({ sensitivity: 'low' })
    expect(useSettings.getState().modes.entertainment.sensitivity).toBe('low')
    expect(useSettings.getState().modes.study.sensitivity).toBe('medium')
  })

  it('restores a mode’s own settings when switching back to it', () => {
    // This is the behaviour the old flat store got wrong: settings leaked across modes.
    useSettings.getState().updateMode({ breakIntervalMin: 60, sensitivity: 'low' }, 'study')
    useSettings.getState().updateMode({ breakIntervalMin: 30, sensitivity: 'high' }, 'entertainment')

    useSettings.getState().setMode('entertainment')
    expect(useSettings.getState().active()).toMatchObject({ breakIntervalMin: 30, sensitivity: 'high' })

    useSettings.getState().setMode('study')
    expect(useSettings.getState().active()).toMatchObject({ breakIntervalMin: 60, sensitivity: 'low' })
  })

  it('does not share the notification array between modes', () => {
    useSettings.getState().updateMode({ notificationStyles: ['visual'] }, 'study')
    expect(useSettings.getState().modes.entertainment.notificationStyles).toHaveLength(3)
  })
})

describe('profile', () => {
  it('stores age, behaviour type and preferred activity', () => {
    useSettings.getState().setProfile({ age: 16, preferredActivity: 'studying' })
    expect(useSettings.getState().profile).toMatchObject({ age: 16, preferredActivity: 'studying' })
  })

  it('maps each persona to its starting mode', () => {
    useSettings.getState().applyBehaviorType('gamer')
    expect(useSettings.getState().mode).toBe(BEHAVIOR_DEFAULT_MODE.gamer)
    expect(useSettings.getState().mode).toBe('entertainment')

    useSettings.getState().applyBehaviorType('student')
    expect(useSettings.getState().mode).toBe('study')
  })

  it('fills a preferred activity from the persona when none is set', () => {
    useSettings.getState().applyBehaviorType('gamer')
    expect(useSettings.getState().profile.preferredActivity).toBe('gaming')
  })

  it('re-fills an activity the previous persona filled in when the persona changes', () => {
    useSettings.getState().applyBehaviorType('student')
    useSettings.getState().applyBehaviorType('gamer')
    expect(useSettings.getState().profile.preferredActivity).toBe('gaming')
  })

  it('never overwrites an activity the user picked themselves', () => {
    useSettings.getState().setProfile({ preferredActivity: 'working' })
    useSettings.getState().applyBehaviorType('gamer')
    expect(useSettings.getState().profile.preferredActivity).toBe('working')
  })
})

describe('persona changes outside onboarding', () => {
  it('can update the persona without touching the active mode', () => {
    useSettings.getState().setMode('study')
    useSettings.getState().applyBehaviorType('gamer', { switchMode: false })
    expect(useSettings.getState().profile.behaviorType).toBe('gamer')
    // A running Study session must stay in Study.
    expect(useSettings.getState().mode).toBe('study')
  })

  it('still switches mode by default, as onboarding expects', () => {
    useSettings.getState().setMode('study')
    useSettings.getState().applyBehaviorType('gamer')
    expect(useSettings.getState().mode).toBe('entertainment')
  })
})

describe('migration from v1', () => {
  /** Rebuild the store from a persisted v1 payload, as a returning user would. */
  function migrateV1(payload: Record<string, unknown>) {
    localStorage.setItem(
      'postureguard:settings',
      JSON.stringify({ state: payload, version: 1 }),
    )
    useSettings.persist.rehydrate()
    return useSettings.getState()
  }

  it('moves the old flat settings into whichever mode was active', () => {
    const s = migrateV1({
      mode: 'entertainment',
      breakIntervalMin: 60,
      sensitivity: 'low',
      notificationStyles: ['visual'],
      activityType: 'gaming',
      participantId: 'P-OLD',
    })

    expect(s.mode).toBe('entertainment')
    expect(s.modes.entertainment).toMatchObject({
      breakIntervalMin: 60,
      sensitivity: 'low',
      notificationStyles: ['visual'],
    })
  })

  it('drops the v1 flat fields once they have been migrated', () => {
    const s = migrateV1({ mode: 'study', breakIntervalMin: 60, sensitivity: 'low', activityType: 'working' })
    expect(s).not.toHaveProperty('breakIntervalMin')
    expect(s).not.toHaveProperty('activityType')
  })

  it('leaves the other mode on its defaults', () => {
    const s = migrateV1({ mode: 'entertainment', breakIntervalMin: 60, sensitivity: 'low' })
    expect(s.modes.study).toMatchObject(MODE_DEFAULTS.study)
  })

  it("carries v1's activity type into the new profile", () => {
    const s = migrateV1({ mode: 'study', activityType: 'working' })
    expect(s.profile.preferredActivity).toBe('working')
  })

  it('keeps the participant id, so a mid-pilot upgrade does not break the dataset', () => {
    const s = migrateV1({ mode: 'study', participantId: 'P-KEEP' })
    expect(s.participantId).toBe('P-KEEP')
  })

  it('survives a v1 payload with missing fields', () => {
    const s = migrateV1({})
    expect(s.mode).toBe('study')
    expect(s.modes.study).toMatchObject(MODE_DEFAULTS.study)
    expect(s.profile.age).toBeNull()
  })
})

describe('parseAge', () => {
  it('returns whole years for a plausible age', () => {
    expect(parseAge('16')).toBe(16)
    expect(parseAge('16.7')).toBe(16)
  })

  it('treats empty, non-numeric and implausible input as unset', () => {
    expect(parseAge('')).toBeNull()
    expect(parseAge('abc')).toBeNull()
    expect(parseAge('-3')).toBeNull()
    expect(parseAge('1e12')).toBeNull()
  })
})
