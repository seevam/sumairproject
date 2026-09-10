import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'insecure'

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
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
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
