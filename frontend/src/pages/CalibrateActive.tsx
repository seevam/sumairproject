import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CameraView } from '../components/CameraView'
import { CameraIndicator } from '../components/CameraIndicator'
import { useCamera } from '../hooks/useCamera'
import { usePoseLoop, type PoseFrame } from '../hooks/usePoseLoop'
import { extractLandmarkMap, medianMetrics } from '../lib/posture'
import { saveCalibration } from '../lib/db'
import { getPoseDiagnostics, type PoseDiagnostics } from '../lib/poseEngine'
import type { PostureMetrics } from '../types'

const CAPTURE_SECONDS = 10
/** Consecutive seconds of a clean, stable pose before the countdown starts. */
const LOCK_SECONDS = 2

type Stage = 'positioning' | 'capturing' | 'done'

export function CalibrateActive() {
  const navigate = useNavigate()
  const { videoRef, status, error } = useCamera(true)
  const [stage, setStage] = useState<Stage>('positioning')
  const [progress, setProgress] = useState(0)
  const [holdSeconds, setHoldSeconds] = useState(0)

  // Samples accumulate outside React state: this runs at frame rate.
  const samples = useRef<PostureMetrics[]>([])
  const landmarkSample = useRef<Record<string, { x: number; y: number }> | null>(null)
  const stageRef = useRef<Stage>('positioning')
  stageRef.current = stage

  const onFrame = useCallback((frame: PoseFrame) => {
    if (stageRef.current !== 'capturing' || !frame.metrics) return
    samples.current.push(frame.metrics)
    if (frame.landmarks) landmarkSample.current = extractLandmarkMap(frame.landmarks)
  }, [])

  // No baseline yet, so deviation is meaningless here; we only need presence.
  const { frame, modelStatus, modelError } = usePoseLoop(videoRef, status === 'ready', null, onFrame)
  const diagnostics = useStallDiagnostics(modelStatus === 'ready' && stage === 'positioning' && !frame.present)

  const ready = status === 'ready' && modelStatus === 'ready' && frame.present

  // Require a couple of stable seconds before committing, so a user still
  // shuffling into position does not get captured mid-movement.
  useEffect(() => {
    if (stage !== 'positioning') return
    if (!ready) {
      setHoldSeconds(0)
      return
    }
    const id = window.setInterval(() => {
      setHoldSeconds((h) => {
        if (h + 1 >= LOCK_SECONDS) {
          samples.current = []
          setStage('capturing')
          return 0
        }
        return h + 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [stage, ready])

  useEffect(() => {
    if (stage !== 'capturing') return
    const started = performance.now()
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000
      setProgress(Math.min(1, elapsed / CAPTURE_SECONDS))
      if (elapsed >= CAPTURE_SECONDS) {
        clearInterval(id)
        void finish()
      }
    }, 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // Lost the user mid-capture: throw the partial sample away and restart.
  useEffect(() => {
    if (stage === 'capturing' && !frame.present) {
      setStage('positioning')
      setProgress(0)
      samples.current = []
    }
  }, [stage, frame.present])

  async function finish() {
    const collected = samples.current
    if (collected.length < 10) {
      setStage('positioning')
      setProgress(0)
      return
    }

    const metrics = medianMetrics(collected)

    await saveCalibration({
      createdAt: Date.now(),
      metrics,
      landmarks: landmarkSample.current ?? {},
      isDefault: false,
    })
    setStage('done')
  }

  const blocked = status === 'denied' || status === 'unavailable' || status === 'insecure' || modelStatus === 'error'

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {stage === 'done' ? 'Calibration complete' : 'Hold your best posture'}
        </h1>
        <CameraIndicator active={status === 'ready'} />
      </div>

      {blocked ? (
        <div className="card space-y-3 border-danger/50 p-5">
          <p className="font-semibold text-danger">
            {modelStatus === 'error' ? 'Cannot start pose detection' : 'Cannot start the camera'}
          </p>
          <p className="text-sm text-muted">{error ?? modelError}</p>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => window.location.reload()}>Try again</button>
            <button className="btn-tertiary" onClick={() => navigate('/calibrate')}>Back</button>
          </div>
        </div>
      ) : (
        <>
          <CameraView
            videoRef={videoRef}
            landmarks={frame.landmarks}
            postureState={frame.present ? 'good' : 'absent'}
            className="aspect-[4/3] w-full"
          />

          <div className="card space-y-3 p-5">
            {stage === 'done' ? (
              <>
                <p className="font-semibold text-accent">Baseline captured</p>
                <p className="text-sm text-muted">
                  PostureGuard now knows what your good posture looks like. You can re-run this any time from Settings.
                </p>
                <button className="btn-primary" onClick={() => navigate('/dashboard')}>
                  Go to dashboard
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className={frame.present ? 'font-semibold text-accent' : 'text-muted'}>
                    {modelStatus === 'loading'
                      ? 'Loading pose model...'
                      : frame.present
                        ? stage === 'capturing'
                          ? 'Capturing - stay still'
                          : 'Position detected'
                        : 'Move so your head and both shoulders are in frame'}
                  </span>
                  {stage === 'capturing' && (
                    <span className="tabular text-muted">
                      {Math.ceil(CAPTURE_SECONDS * (1 - progress))}s
                    </span>
                  )}
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-100"
                    style={{
                      width: `${
                        stage === 'capturing' ? progress * 100 : (holdSeconds / LOCK_SECONDS) * 100
                      }%`,
                    }}
                  />
                </div>

                {diagnostics && <DiagnosticsLine d={diagnostics} />}

                <button className="btn-tertiary" onClick={() => navigate('/calibrate')}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** How long detection may find nobody before we show what it is doing. */
const STALL_SECONDS = 8

/**
 * Returns live detection diagnostics once a stall has lasted STALL_SECONDS.
 * Detection problems are machine-specific and cannot be reproduced remotely,
 * so when calibration is stuck the screen shows exactly what the engine sees -
 * a screenshot of this line is enough to diagnose it.
 */
function useStallDiagnostics(stalled: boolean): PoseDiagnostics | null {
  const [diag, setDiag] = useState<PoseDiagnostics | null>(null)

  useEffect(() => {
    if (!stalled) {
      setDiag(null)
      return
    }
    const since = Date.now()
    const id = window.setInterval(() => {
      if (Date.now() - since >= STALL_SECONDS * 1000) setDiag(getPoseDiagnostics())
    }, 1000)
    return () => clearInterval(id)
  }, [stalled])

  return diag
}

function DiagnosticsLine({ d }: { d: PoseDiagnostics }) {
  return (
    <div className="rounded-btn border border-line bg-surface-2 p-3 text-xs leading-relaxed text-muted">
      <p className="font-medium text-white">Still looking for you.</p>
      <p>
        Sit so your face and both shoulders are visible, with light in front of you rather than
        behind. If you are clearly in frame, send a screenshot of this box:
      </p>
      <p className="tabular mt-1.5 font-mono text-[11px]">
        {d.backend ?? '?'} - {d.framesAnalysed} frames - {d.posesFound} poses - {d.errors} errors -{' '}
        {d.invalidResults} invalid - {d.crossChecks} checks
        {d.fallbackReason && <><br />fallback: {d.fallbackReason}</>}
        {d.lastError && <><br />last error: {d.lastError}</>}
      </p>
    </div>
  )
}
