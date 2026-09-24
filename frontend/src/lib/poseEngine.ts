import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { DelegateHealth, allFinite } from './delegateHealth'

/**
 * Wrapper around MediaPipe Pose Landmarker.
 *
 * The WASM runtime and the .task model are both served from our own origin
 * (public/wasm, public/models) rather than a CDN: pilot participants must be
 * able to start a session without depending on a third-party host being up, and
 * self-hosting keeps the "nothing leaves your device" promise easy to verify.
 *
 * GPU is tried first because it is faster, but GPU delegates fail silently on
 * some machines (see delegateHealth.ts). Such a failure is detected at runtime,
 * the engine drops to CPU, and the choice is remembered for this device.
 */

export type Delegate = 'GPU' | 'CPU'

const PREFERENCE_KEY = 'postureguard:pose-delegate'
const MODEL_PATH = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

let fileset: Fileset | null = null
let landmarker: PoseLandmarker | null = null
let backend: Delegate | null = null
let loading: Promise<PoseLandmarker> | null = null
let switching = false

/** CPU landmarker in IMAGE mode, used only to cross-check a silent GPU. */
let checker: PoseLandmarker | null = null
let checking = false

let health = new DelegateHealth()

export interface PoseDiagnostics {
  backend: Delegate | null
  framesAnalysed: number
  posesFound: number
  errors: number
  invalidResults: number
  crossChecks: number
  lastError: string | null
  /** Why the engine fell back to CPU, if it did. */
  fallbackReason: string | null
}

const diagnostics: PoseDiagnostics = {
  backend: null,
  framesAnalysed: 0,
  posesFound: 0,
  errors: 0,
  invalidResults: 0,
  crossChecks: 0,
  lastError: null,
  fallbackReason: null,
}

/** Snapshot of what detection has been doing - shown when calibration stalls. */
export function getPoseDiagnostics(): PoseDiagnostics {
  return { ...diagnostics, backend }
}

export function isReady(): boolean {
  return landmarker !== null
}

export function activeBackend(): Delegate | null {
  return backend
}

function preferredDelegate(): Delegate {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'CPU' ? 'CPU' : 'GPU'
  } catch {
    return 'GPU'
  }
}

async function getFileset(): Promise<Fileset> {
  if (!fileset) fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`)
  return fileset
}

async function create(delegate: Delegate, runningMode: 'VIDEO' | 'IMAGE'): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(await getFileset(), {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  })
}

/**
 * MediaPipe needs WebGL on both delegates - verified: with WebGL unavailable,
 * even the CPU graph fails on every frame. Without this check that machine
 * shows "move into frame" forever; with it, the user gets a fix they can apply.
 */
export const WEBGL_REQUIRED_MESSAGE =
  'Pose detection needs WebGL, which is turned off in this browser. In Chrome, open ' +
  'Settings > System and turn on "Use graphics acceleration when available", then relaunch.'

function assertWebGL(): void {
  const canvas = document.createElement('canvas')
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
    throw new Error(WEBGL_REQUIRED_MESSAGE)
  }
}

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (landmarker) return Promise.resolve(landmarker)
  if (loading) return loading

  loading = (async () => {
    assertWebGL()
    const preferred = preferredDelegate()
    let instance: PoseLandmarker
    try {
      instance = await create(preferred, 'VIDEO')
      backend = preferred
    } catch (err) {
      if (preferred === 'CPU') throw err
      // WebGL unavailable: older graphics, remote desktop, acceleration off.
      instance = await create('CPU', 'VIDEO')
      backend = 'CPU'
      diagnostics.fallbackReason = `GPU delegate failed to load: ${message(err)}`
    }
    landmarker = instance
    health = new DelegateHealth()
    return instance
  })()

  loading.catch(() => {
    // Let a later attempt retry instead of caching the rejection forever.
    loading = null
  })

  return loading
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Replace a misbehaving GPU landmarker with a CPU one, and remember it. */
async function switchToCpu(reason: string): Promise<void> {
  if (switching || backend === 'CPU') return
  switching = true
  try {
    const cpu = await create('CPU', 'VIDEO')
    const old = landmarker
    landmarker = cpu
    backend = 'CPU'
    health = new DelegateHealth()
    diagnostics.fallbackReason = reason
    old?.close()
    try {
      localStorage.setItem(PREFERENCE_KEY, 'CPU')
    } catch {
      /* private mode: we simply re-detect the problem next time */
    }
  } catch (err) {
    diagnostics.lastError = `CPU fallback failed: ${message(err)}`
  } finally {
    switching = false
  }
}

/** Runs one frame through the CPU. If it finds a person the GPU missed, the GPU is broken. */
async function crossCheck(video: HTMLVideoElement): Promise<void> {
  if (checking) return
  checking = true
  try {
    if (!checker) checker = await create('CPU', 'IMAGE')
    diagnostics.crossChecks += 1
    const pose = checker.detect(video).landmarks?.[0]
    if (pose && allFinite(pose)) {
      await switchToCpu('GPU delegate found no pose on a frame where the CPU found one')
      checker.close()
      checker = null
    }
  } catch (err) {
    diagnostics.lastError = `cross-check failed: ${message(err)}`
  } finally {
    checking = false
  }
}

export function detect(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
  if (!landmarker || switching) return null
  if (video.readyState < 2 || video.videoWidth === 0) return null

  let result: PoseLandmarkerResult
  try {
    result = landmarker.detectForVideo(video, timestampMs)
  } catch (err) {
    // One failure is often transient (the video element being re-attached).
    // A run of them on the GPU means the delegate does not work on this machine.
    diagnostics.errors += 1
    diagnostics.lastError = message(err)
    if (backend === 'GPU' && health.onError() === 'switch') {
      void switchToCpu(`GPU delegate failed repeatedly: ${message(err)}`)
    }
    return null
  }

  diagnostics.framesAnalysed += 1
  const pose = result.landmarks?.[0]

  if (pose && !allFinite(pose)) {
    diagnostics.invalidResults += 1
    if (backend === 'GPU') void switchToCpu('GPU delegate returned non-finite landmarks')
    return null
  }

  if (pose) {
    diagnostics.posesFound += 1
    health.onPose()
  } else if (backend === 'GPU' && health.onEmpty(timestampMs) === 'crosscheck') {
    void crossCheck(video)
  }

  return result
}

export function disposePoseLandmarker(): void {
  landmarker?.close()
  checker?.close()
  landmarker = null
  checker = null
  loading = null
  backend = null
}

/** Skeleton edges for the overlay, limited to the landmarks we actually use. */
export const OVERLAY_EDGES: Array<[number, number]> = [
  [11, 12], // shoulder line
  [7, 8], // ear line
  [0, 7],
  [0, 8],
  [11, 0],
  [12, 0],
]
