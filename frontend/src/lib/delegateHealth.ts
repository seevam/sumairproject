/**
 * Decides when MediaPipe's GPU delegate should be abandoned for the CPU one.
 *
 * Failing to *load* the GPU delegate is easy to catch. The harder case is a
 * GPU delegate that loads fine and then fails silently on a particular machine:
 * it throws on every frame, returns non-finite coordinates, or simply never
 * finds a pose. From the user's side all three look the same - a person
 * clearly in frame and an app that insists they are not.
 *
 * "Never finds a pose" is also what an empty room looks like, so an empty run
 * alone does not justify a switch. Instead it triggers a cross-check: the same
 * frame is run once through the CPU delegate. Only if the CPU finds a person
 * the GPU missed is the GPU judged broken.
 */

/** Consecutive detection errors before giving up on the GPU. */
export const MAX_CONSECUTIVE_ERRORS = 3
/** How long the GPU may report no pose before we cross-check it. */
export const EMPTY_BEFORE_CROSSCHECK_MS = 3000
/** After a cross-check that agrees nobody is there, wait this long before another. */
export const CROSSCHECK_BACKOFF_MS = 10000

export type HealthVerdict = 'ok' | 'crosscheck' | 'switch'

export class DelegateHealth {
  private consecutiveErrors = 0
  private emptySince: number | null = null
  private nextCrossCheckAt = 0

  /** detectForVideo threw. */
  onError(): HealthVerdict {
    this.consecutiveErrors += 1
    return this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS ? 'switch' : 'ok'
  }

  /** A frame produced a usable pose: the delegate is demonstrably working. */
  onPose(): void {
    this.consecutiveErrors = 0
    this.emptySince = null
  }

  /** A frame was analysed and no pose was found. */
  onEmpty(now: number): HealthVerdict {
    this.consecutiveErrors = 0
    if (this.emptySince === null) this.emptySince = now
    if (now - this.emptySince < EMPTY_BEFORE_CROSSCHECK_MS) return 'ok'
    if (now < this.nextCrossCheckAt) return 'ok'
    this.nextCrossCheckAt = now + CROSSCHECK_BACKOFF_MS
    return 'crosscheck'
  }
}

/** True when every coordinate is a real number. A broken delegate can emit NaN. */
export function allFinite(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  return points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}
