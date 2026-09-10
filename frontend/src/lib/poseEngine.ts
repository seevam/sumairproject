import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'

/**
 * Thin wrapper around MediaPipe Pose Landmarker.
 *
 * The WASM runtime and the .task model are both served from our own origin
 * (public/wasm, public/models) rather than a CDN: pilot participants must be
 * able to start a session without depending on a third-party host being up, and
 * self-hosting keeps the "nothing leaves your device" promise easy to verify.
 */

let landmarker: PoseLandmarker | null = null
let loading: Promise<PoseLandmarker> | null = null
let backend: 'GPU' | 'CPU' | null = null

/** Which delegate the model actually loaded on. Surfaced in the UI for support. */
export function activeBackend(): 'GPU' | 'CPU' | null {
  return backend
}

export function isReady(): boolean {
  return landmarker !== null
}

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (landmarker) return Promise.resolve(landmarker)
  if (loading) return loading

  loading = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`)

    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      })

    // GPU is roughly 3x faster, but WebGL is unavailable on some machines
    // (older integrated graphics, remote desktops, hardware acceleration
    // switched off). Falling back to CPU keeps those participants in the study.
    let instance: PoseLandmarker
    try {
      instance = await create('GPU')
      backend = 'GPU'
    } catch {
      instance = await create('CPU')
      backend = 'CPU'
    }

    landmarker = instance
    return instance
  })()

  loading.catch(() => {
    // Let a later attempt retry instead of caching the rejection forever.
    loading = null
  })

  return loading
}

export function detect(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
  if (!landmarker) return null
  if (video.readyState < 2 || video.videoWidth === 0) return null
  try {
    return landmarker.detectForVideo(video, timestampMs)
  } catch {
    // A transient failure (e.g. the video element being re-attached) should not
    // kill the loop; the next frame usually succeeds.
    return null
  }
}

export function disposePoseLandmarker(): void {
  landmarker?.close()
  landmarker = null
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
