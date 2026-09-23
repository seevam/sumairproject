import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { detect, loadPoseLandmarker } from '../lib/poseEngine'
import {
  DeviationSmoother,
  computeDeviation,
  computeMetrics,
  landmarksVisible,
  type RawLandmark,
} from '../lib/posture'
import type { CalibrationBaseline, PostureMetrics } from '../types'

export interface PoseFrame {
  landmarks: RawLandmark[] | null
  metrics: PostureMetrics | null
  deviationPct: number
  present: boolean
  fps: number
}

const EMPTY: PoseFrame = { landmarks: null, metrics: null, deviationPct: 0, present: false, fps: 0 }

/**
 * Detection cadence while the tab is hidden. requestAnimationFrame does not run
 * in background tabs, so a hidden tab falls back to a timer; browsers throttle
 * that to about once a second, which is still plenty for posture.
 */
const HIDDEN_INTERVAL_MS = 500

/**
 * Runs MediaPipe against the video element on every animation frame and
 * publishes the derived posture signal.
 *
 * Detection results are pushed through a ref and mirrored into state at ~10Hz.
 * Setting state on every frame would re-render the whole tree 30 times a second
 * for numbers that only need to be readable.
 */
export function usePoseLoop(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  baseline: CalibrationBaseline | null,
  onFrame?: (frame: PoseFrame) => void,
) {
  const [frame, setFrame] = useState<PoseFrame>(EMPTY)
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelError, setModelError] = useState<string | null>(null)

  const latest = useRef<PoseFrame>(EMPTY)
  const smoother = useRef(new DeviationSmoother())
  const baselineRef = useRef(baseline)
  const onFrameRef = useRef(onFrame)

  // Keep the loop reading current values without re-subscribing every render.
  baselineRef.current = baseline
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!enabled) {
      smoother.current.reset()
      latest.current = EMPTY
      setFrame(EMPTY)
      return
    }

    let raf = 0
    let hiddenTimer = 0
    let publishTimer = 0
    let onVisibility: (() => void) | null = null
    let cancelled = false
    let lastVideoTime = -1
    let lastFrameAt = performance.now()
    let fps = 0

    async function run() {
      setModelStatus('loading')
      try {
        await loadPoseLandmarker()
      } catch (err) {
        if (cancelled) return
        setModelStatus('error')
        setModelError(err instanceof Error ? err.message : 'Failed to load the pose model.')
        return
      }
      if (cancelled) return
      setModelStatus('ready')

      // rAF when visible (smooth, paused by the browser when hidden); a timer
      // when hidden, so monitoring continues while the user works in another tab.
      const schedule = () => {
        if (cancelled) return
        if (document.hidden) hiddenTimer = window.setTimeout(step, HIDDEN_INTERVAL_MS)
        else raf = requestAnimationFrame(step)
      }

      const step = () => {
        if (cancelled) return
        schedule()

        const video = videoRef.current
        if (!video) return

        // detectForVideo requires strictly increasing timestamps; skipping
        // repeated frames also saves a pointless inference pass.
        if (video.currentTime === lastVideoTime) return
        lastVideoTime = video.currentTime

        const now = performance.now()
        const result = detect(video, now)

        const delta = now - lastFrameAt
        lastFrameAt = now
        if (delta > 0) fps = fps === 0 ? 1000 / delta : fps * 0.9 + (1000 / delta) * 0.1

        const landmarks = (result?.landmarks?.[0] as RawLandmark[] | undefined) ?? null
        const present = landmarksVisible(landmarks)

        if (!present || !landmarks) {
          smoother.current.reset()
          latest.current = { landmarks, metrics: null, deviationPct: 0, present: false, fps }
          onFrameRef.current?.(latest.current)
          return
        }

        const metrics = computeMetrics(landmarks)
        const base = baselineRef.current
        const raw = base ? computeDeviation(metrics, base.metrics).total : 0
        const deviationPct = base ? smoother.current.push(raw) : 0

        latest.current = { landmarks, metrics, deviationPct, present: true, fps }
        onFrameRef.current?.(latest.current)
      }

      // A rAF queued just before the tab hides would never fire, stalling the
      // loop for as long as the tab stays hidden. Reschedule on every change.
      onVisibility = () => {
        cancelAnimationFrame(raf)
        clearTimeout(hiddenTimer)
        schedule()
      }
      document.addEventListener('visibilitychange', onVisibility)

      schedule()
      // Mirror to React state at 10Hz: fast enough to feel live, slow enough
      // to keep the render cost off the detection loop.
      publishTimer = window.setInterval(() => setFrame({ ...latest.current }), 100)
    }

    void run()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      clearTimeout(hiddenTimer)
      clearInterval(publishTimer)
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, videoRef])

  return { frame, latest, modelStatus, modelError }
}
