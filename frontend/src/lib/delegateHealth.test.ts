import { describe, expect, it } from 'vitest'
import {
  CROSSCHECK_BACKOFF_MS,
  DelegateHealth,
  EMPTY_BEFORE_CROSSCHECK_MS,
  MAX_CONSECUTIVE_ERRORS,
  allFinite,
} from './delegateHealth'

describe('DelegateHealth', () => {
  it('abandons the GPU after repeated detection errors', () => {
    const h = new DelegateHealth()
    for (let i = 1; i < MAX_CONSECUTIVE_ERRORS; i++) expect(h.onError()).toBe('ok')
    expect(h.onError()).toBe('switch')
  })

  it('forgives isolated errors between good frames', () => {
    const h = new DelegateHealth()
    for (let i = 0; i < 10; i++) {
      expect(h.onError()).toBe('ok')
      h.onPose()
    }
  })

  it('does not cross-check a brief gap with no pose', () => {
    const h = new DelegateHealth()
    expect(h.onEmpty(0)).toBe('ok')
    expect(h.onEmpty(EMPTY_BEFORE_CROSSCHECK_MS - 1)).toBe('ok')
  })

  it('cross-checks once no pose has been found for long enough', () => {
    const h = new DelegateHealth()
    h.onEmpty(0)
    expect(h.onEmpty(EMPTY_BEFORE_CROSSCHECK_MS)).toBe('crosscheck')
  })

  it('backs off after a cross-check, so an empty room is not re-checked every frame', () => {
    const h = new DelegateHealth()
    h.onEmpty(0)
    const t = EMPTY_BEFORE_CROSSCHECK_MS
    expect(h.onEmpty(t)).toBe('crosscheck')
    expect(h.onEmpty(t + 100)).toBe('ok')
    expect(h.onEmpty(t + CROSSCHECK_BACKOFF_MS - 1)).toBe('ok')
    expect(h.onEmpty(t + CROSSCHECK_BACKOFF_MS)).toBe('crosscheck')
  })

  it('restarts the empty timer once a pose is seen', () => {
    const h = new DelegateHealth()
    h.onEmpty(0)
    h.onPose()
    expect(h.onEmpty(EMPTY_BEFORE_CROSSCHECK_MS)).toBe('ok')
  })

  it('never recommends a switch from empty frames alone', () => {
    // An empty room must not look like a broken GPU.
    const h = new DelegateHealth()
    for (let t = 0; t < 60_000; t += 100) expect(h.onEmpty(t)).not.toBe('switch')
  })
})

describe('allFinite', () => {
  it('accepts ordinary coordinates', () => {
    expect(allFinite([{ x: 0.5, y: 0.4 }, { x: 0, y: 1 }])).toBe(true)
  })

  it('rejects NaN and infinity', () => {
    expect(allFinite([{ x: Number.NaN, y: 0.4 }])).toBe(false)
    expect(allFinite([{ x: 0.5, y: Number.POSITIVE_INFINITY }])).toBe(false)
  })
})
