import { describe, expect, it } from 'vitest'
import {
  DeviationSmoother,
  computeDeviation,
  computeMetrics,
  landmarksVisible,
  thresholdFor,
  type RawLandmark,
} from './posture'

/** A full 33-landmark array with only the points PostureGuard uses set meaningfully. */
function pose(nose: [number, number], ls: [number, number], rs: [number, number]): RawLandmark[] {
  const arr: RawLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))
  arr[0] = { x: nose[0], y: nose[1], visibility: 0.95 }
  arr[7] = { x: nose[0] - 0.06, y: nose[1] + 0.01, visibility: 0.9 }
  arr[8] = { x: nose[0] + 0.06, y: nose[1] + 0.01, visibility: 0.9 }
  arr[11] = { x: ls[0], y: ls[1], visibility: 0.95 }
  arr[12] = { x: rs[0], y: rs[1], visibility: 0.95 }
  return arr
}

const UPRIGHT = pose([0.5, 0.25], [0.33, 0.6], [0.67, 0.6])
const BASE = computeMetrics(UPRIGHT)
const deviationOf = (p: RawLandmark[]) => computeDeviation(computeMetrics(p), BASE).total

describe('computeMetrics', () => {
  it('reads an upright pose as zero neck angle and zero shoulder tilt', () => {
    expect(Math.abs(BASE.neckAngleDeg)).toBeLessThan(0.5)
    expect(Math.abs(BASE.shoulderTiltDeg)).toBeLessThan(0.5)
  })
})

describe('computeDeviation', () => {
  it('scores an unchanged pose as zero', () => {
    expect(deviationOf(UPRIGHT)).toBe(0)
  })

  it('ignores distance from the camera', () => {
    // Same posture, whole body 25% smaller and lower in frame.
    const far = pose([0.5, 0.35], [0.3725, 0.6125], [0.6275, 0.6125])
    expect(deviationOf(far)).toBeLessThan(5)
  })

  it('flags a slouch where the head sinks toward the shoulders', () => {
    expect(deviationOf(pose([0.5, 0.42], [0.33, 0.6], [0.67, 0.6]))).toBeGreaterThan(15)
  })

  it('flags a sideways head lean', () => {
    expect(deviationOf(pose([0.62, 0.28], [0.33, 0.6], [0.67, 0.6]))).toBeGreaterThan(15)
  })

  it('flags leaning in toward the screen', () => {
    expect(deviationOf(pose([0.5, 0.22], [0.28, 0.63], [0.72, 0.63]))).toBeGreaterThan(5)
  })

  it('never penalises posture that is better than baseline', () => {
    const taller = pose([0.5, 0.18], [0.34, 0.6], [0.66, 0.6])
    expect(deviationOf(taller)).toBeLessThan(thresholdFor('medium').warning)
  })

  it('accounts for uneven shoulders', () => {
    expect(deviationOf(pose([0.5, 0.25], [0.33, 0.66], [0.67, 0.56]))).toBeGreaterThan(3)
  })

  it('stays within 0-100 even for an extreme pose', () => {
    const extreme = deviationOf(pose([0.95, 0.58], [0.1, 0.62], [0.9, 0.58]))
    expect(extreme).toBeGreaterThan(thresholdFor('medium').poor)
    expect(extreme).toBeLessThanOrEqual(100)
  })
})

describe('thresholdFor', () => {
  it('orders sensitivities so that "high" alerts soonest', () => {
    expect(thresholdFor('high').warning).toBeLessThan(thresholdFor('medium').warning)
    expect(thresholdFor('medium').warning).toBeLessThan(thresholdFor('low').warning)
  })

  it('keeps the PRD default at 15%', () => {
    expect(thresholdFor('medium').warning).toBe(15)
  })
})

describe('landmarksVisible', () => {
  it('accepts a fully visible pose', () => {
    expect(landmarksVisible(UPRIGHT)).toBe(true)
  })

  it('rejects a pose with an occluded shoulder', () => {
    const hidden = pose([0.5, 0.25], [0.33, 0.6], [0.67, 0.6])
    hidden[11] = { ...hidden[11], visibility: 0.2 }
    expect(landmarksVisible(hidden)).toBe(false)
  })

  it('rejects missing landmarks', () => {
    expect(landmarksVisible(null)).toBe(false)
    expect(landmarksVisible([])).toBe(false)
  })
})

describe('DeviationSmoother', () => {
  it('adopts the first sample directly so the badge is never stale at session start', () => {
    const s = new DeviationSmoother(0.12)
    s.push(40)
    expect(s.current).toBe(40)
  })

  it('converges on a sustained input', () => {
    const s = new DeviationSmoother(0.12)
    for (let i = 0; i < 200; i++) s.push(40)
    expect(Math.abs(s.current - 40)).toBeLessThan(0.5)
  })

  it('damps a single-frame spike', () => {
    const s = new DeviationSmoother(0.12)
    for (let i = 0; i < 50; i++) s.push(5)
    s.push(90)
    // One bad frame must not be enough to cross the warning threshold.
    expect(s.current).toBeLessThan(thresholdFor('medium').warning)
  })
})
