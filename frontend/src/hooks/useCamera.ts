import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'insecure'

/**
 * Camera profile: front-facing only. Confirmed decision, not a placeholder.
 *
 * PostureGuard's geometry assumes the user is facing the screen - it reads the
 * nose against the shoulder line, which is only meaningful from the front. A
 * rear or side camera would produce landmarks the deviation maths cannot
 * interpret, so no other orientation is offered and there is no device picker.
 *
 * `facingMode: 'user'` is a preference rather than `exact`, deliberately: most
 * laptop and USB webcams do not report a facingMode at all, and an exact
 * constraint would fail outright on those machines. As a preference the browser
 * picks the front camera where one is labelled and the default camera
 * otherwise, which on a laptop is the built-in front-facing one.
 */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: 'user',
}

/**
 * Owns the getUserMedia stream and keeps it attached to a video element.
 * The stream is stopped on unmount so the OS camera light goes out the moment
 * the user leaves a screen that needs the camera (US-31).
 */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => {
    if (!active) {
      stop()
      setStatus('idle')
      return
    }

    let cancelled = false

    async function open() {
      // getUserMedia is only exposed on secure origins; localhost counts as secure.
      if (!window.isSecureContext) {
        setStatus('insecure')
        setError('Camera access requires HTTPS (or localhost).')
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable')
        setError('This browser does not expose a camera API.')
        return
      }

      setStatus('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: VIDEO_CONSTRAINTS,
          // Never requested: PostureGuard has no use for audio, and asking for
          // it would widen the permission prompt for no reason.
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setStatus('ready')
        setError(null)
      } catch (err) {
        if (cancelled) return
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied')
          setError('Camera permission was denied. Enable it in your browser site settings.')
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setStatus('unavailable')
          setError('No camera was found on this device.')
        } else {
          setStatus('unavailable')
          setError(err instanceof Error ? err.message : 'Could not open the camera.')
        }
      }
    }

    void open()
    return () => {
      cancelled = true
      stop()
    }
  }, [active, stop])

  return { videoRef, status, error, stop }
}
