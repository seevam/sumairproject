import type { CalibrationBaseline, PostureMetrics, PosturePoint, Sensitivity } from '../types'

/**
 * MediaPipe Pose landmark indices we rely on (PRD 7.1). We deliberately use only
 * head and shoulder points: they are stable while seated at a desk, and they are
 * enough to characterise forward-head posture and slouch without needing the
 * lower body in frame.
 */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
} as const

/** Landmarks below this visibility score are treated as not seen at all. */
const MIN_VISIBILITY = 0.5

export interface RawLandmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export function landmarksVisible(landmarks: RawLandmark[] | null | undefined): boolean {
  if (!landmarks || landmarks.length < 33) return false
  return Object.values(LM).every((i) => {
    const p = landmarks[i]
    // visibility is optional in the task API; absence means "reported, assume visible".
    return p && (p.visibility === undefined || p.visibility >= MIN_VISIBILITY)
  })
}

function midpoint(a: PosturePoint, b: PosturePoint): PosturePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function distance(a: PosturePoint, b: PosturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Reduce a frame of landmarks to four scale-invariant numbers.
 *
 * Everything is normalised by shoulder width so that moving closer to or further
 * from the camera does not by itself register as a posture change. Image
 * coordinates run top-down, so a *smaller* y is *higher* in the frame.
 */
export function computeMetrics(landmarks: RawLandmark[]): PostureMetrics {
  const nose = landmarks[LM.nose]
  const ls = landmarks[LM.leftShoulder]
  const rs = landmarks[LM.rightShoulder]

  const shoulderMid = midpoint(ls, rs)
  const shoulderWidth = Math.max(distance(ls, rs), 1e-4)

  const dx = nose.x - shoulderMid.x
  const dy = shoulderMid.y - nose.y // positive when the head is above the shoulders

  // Angle away from vertical. atan2(dx, dy) gives 0 for a perfectly upright head.
  const neckAngleDeg = (Math.atan2(dx, Math.max(dy, 1e-4)) * 180) / Math.PI
  const neckRatio = Math.hypot(dx, dy) / shoulderWidth
  const shoulderTiltDeg = (Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180) / Math.PI

  return { neckAngleDeg, neckRatio, shoulderWidth, shoulderTiltDeg }
}

export function extractLandmarkMap(landmarks: RawLandmark[]): Record<string, PosturePoint> {
  const out: Record<string, PosturePoint> = {}
  for (const [name, idx] of Object.entries(LM)) {
    out[name] = { x: landmarks[idx].x, y: landmarks[idx].y }
  }
  return out
}

/**
 * Fallback baseline used when the user skips calibration (US-12, PRD 7.2).
 * Values are the average seated-upright ratios measured from a laptop camera at
 * desk height: head roughly centred over the shoulders, nose about 0.62 shoulder
 * widths above the shoulder line.
 *
 * Age nudges the neck ratio because head size relative to shoulder breadth
 * decreases through adolescence, so a younger participant's nose sits
 * proportionally further above the shoulder line at the same posture. This is a
 * coarse anthropometric approximation, not a validated model - it only affects
 * users who skip calibration, and a real capture replaces it entirely.
 */
const ADULT_NECK_RATIO = 0.62
const YOUNGEST_NECK_RATIO = 0.67
const ADULT_AGE = 18
const YOUNGEST_AGE = 10

export function defaultBaseline(age?: number | null): CalibrationBaseline {
  let neckRatio = ADULT_NECK_RATIO
  if (typeof age === 'number' && Number.isFinite(age) && age < ADULT_AGE) {
    const clamped = Math.max(YOUNGEST_AGE, age)
    const t = (ADULT_AGE - clamped) / (ADULT_AGE - YOUNGEST_AGE)
    neckRatio = ADULT_NECK_RATIO + t * (YOUNGEST_NECK_RATIO - ADULT_NECK_RATIO)
  }

  return {
    createdAt: Date.now(),
    isDefault: true,
    metrics: {
      neckAngleDeg: 0,
      neckRatio: Math.round(neckRatio * 1000) / 1000,
      shoulderWidth: 0.34,
      shoulderTiltDeg: 0,
    },
    landmarks: {},
  }
}

/**
 * Collapse a run of captured frames into one baseline.
 *
 * Median per component rather than mean: MediaPipe produces a handful of badly
 * placed landmarks during a 10-second capture (blinks, a shift in the chair),
 * and a median discards them without needing explicit outlier rejection.
 */
export function medianMetrics(samples: PostureMetrics[]): PostureMetrics {
  if (samples.length === 0) throw new Error('medianMetrics requires at least one sample')

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  return {
    neckAngleDeg: median(samples.map((m) => m.neckAngleDeg)),
    neckRatio: median(samples.map((m) => m.neckRatio)),
    shoulderWidth: median(samples.map((m) => m.shoulderWidth)),
    shoulderTiltDeg: median(samples.map((m) => m.shoulderTiltDeg)),
  }
}

/**
 * Each component is expressed as "fraction of the deviation budget consumed",
 * where 1.0 means that component alone is a full-scale departure from baseline.
 * The weights sum to 1 so the result stays interpretable as a percentage.
 */
const FULL_SCALE = {
  /** Degrees of neck angle change that count as a complete deviation. */
  neckAngle: 22,
  /** Fractional drop in neck ratio (head sinking) that counts as complete. */
  neckRatio: 0.28,
  /** Fractional growth in shoulder width (leaning in) that counts as complete. */
  lean: 0.22,
  /** Degrees of shoulder tilt change that count as complete. */
  shoulderTilt: 16,
}

const WEIGHTS = {
  neckAngle: 0.3,
  neckRatio: 0.4, // forward-head / slouch is the dominant signal at a desk
  lean: 0.2,
  shoulderTilt: 0.1,
}

export interface DeviationBreakdown {
  total: number
  neckAngle: number
  neckRatio: number
  lean: number
  shoulderTilt: number
}

/**
 * Deviation from the calibrated baseline, as a percentage.
 *
 * Only *worse* posture counts. Sitting up straighter than baseline (a larger
 * neck ratio, shoulders further from the camera) contributes zero rather than a
 * negative, so a user who over-corrects is never told their posture is poor.
 */
export function computeDeviation(
  current: PostureMetrics,
  baseline: PostureMetrics,
): DeviationBreakdown {
  const neckAngle = Math.min(
    1,
    Math.abs(current.neckAngleDeg - baseline.neckAngleDeg) / FULL_SCALE.neckAngle,
  )

  // Slouching shortens the shoulder-to-nose vector; only the shortening direction counts.
  const ratioDrop = (baseline.neckRatio - current.neckRatio) / Math.max(baseline.neckRatio, 1e-4)
  const neckRatio = Math.min(1, Math.max(0, ratioDrop) / FULL_SCALE.neckRatio)

  // Leaning toward the screen makes the shoulders appear wider.
  const widthGrowth = (current.shoulderWidth - baseline.shoulderWidth) / Math.max(baseline.shoulderWidth, 1e-4)
  const lean = Math.min(1, Math.max(0, widthGrowth) / FULL_SCALE.lean)

  const shoulderTilt = Math.min(
    1,
    Math.abs(current.shoulderTiltDeg - baseline.shoulderTiltDeg) / FULL_SCALE.shoulderTilt,
  )

  const total =
    100 *
    (neckAngle * WEIGHTS.neckAngle +
      neckRatio * WEIGHTS.neckRatio +
      lean * WEIGHTS.lean +
      shoulderTilt * WEIGHTS.shoulderTilt)

  return {
    total: Math.round(total * 10) / 10,
    neckAngle: Math.round(neckAngle * 100),
    neckRatio: Math.round(neckRatio * 100),
    lean: Math.round(lean * 100),
    shoulderTilt: Math.round(shoulderTilt * 100),
  }
}

/**
 * The PRD fixes the warning threshold at 15% (PRD 7.1). Sensitivity shifts that
 * threshold rather than changing the maths, so the deviation number logged for
 * research means the same thing for every participant.
 */
export function thresholdFor(sensitivity: Sensitivity): { warning: number; poor: number } {
  switch (sensitivity) {
    case 'low':
      return { warning: 22, poor: 34 }
    case 'high':
      return { warning: 10, poor: 20 }
    case 'medium':
    default:
      return { warning: 15, poor: 26 }
  }
}

/**
 * Noise filter for the deviation signal.
 *
 * MediaPipe occasionally emits a badly misplaced landmark for a single frame -
 * usually when the user blinks, turns their head, or the lighting shifts. Fed
 * straight through, one such frame is enough to flip the posture badge.
 *
 * Two stages handle this: a median over the last few raw samples rejects
 * isolated spikes outright, then an exponential moving average smooths the
 * remaining jitter. A genuine posture change moves the median within three
 * frames (~150ms at 20fps), so responsiveness is unaffected.
 */
export class DeviationSmoother {
  private value: number | null = null
  private readonly alpha: number
  private readonly window: number[] = []
  private readonly windowSize: number

  constructor(alpha = 0.12, windowSize = 5) {
    this.alpha = alpha
    this.windowSize = windowSize
  }

  push(sample: number): number {
    this.window.push(sample)
    if (this.window.length > this.windowSize) this.window.shift()

    const sorted = [...this.window].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    this.value = this.value === null ? median : this.value + this.alpha * (median - this.value)
    return this.value
  }

  reset() {
    this.value = null
    this.window.length = 0
  }

  get current(): number {
    return this.value ?? 0
  }
}
