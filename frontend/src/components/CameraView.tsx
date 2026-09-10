import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { OVERLAY_EDGES } from '../lib/poseEngine'
import { LM, type RawLandmark } from '../lib/posture'
import type { PostureState } from '../types'

const STATE_COLOR: Record<PostureState, string> = {
  good: '#1DB954',
  warning: '#F0A500',
  poor: '#CF222E',
  absent: '#6E7681',
}

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>
  landmarks: RawLandmark[] | null
  postureState: PostureState
  className?: string
}

/**
 * Mirrored camera preview with the pose overlay drawn on a canvas above it.
 * The video is flipped horizontally so the user sees themselves as in a mirror;
 * the canvas is flipped with the same transform so the skeleton stays aligned.
 */
export function CameraView({ videoRef, landmarks, postureState, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match the backing store to the displayed size so lines stay crisp.
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    if (!landmarks) return

    const color = STATE_COLOR[postureState]
    const used = new Set<number>(Object.values(LM))
    const px = (p: RawLandmark) => ({ x: p.x * rect.width, y: p.y * rect.height })

    ctx.lineWidth = 2.5
    ctx.strokeStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 8

    for (const [a, b] of OVERLAY_EDGES) {
      const pa = landmarks[a]
      const pb = landmarks[b]
      if (!pa || !pb) continue
      const A = px(pa)
      const B = px(pb)
      ctx.beginPath()
      ctx.moveTo(A.x, A.y)
      ctx.lineTo(B.x, B.y)
      ctx.stroke()
    }

    ctx.shadowBlur = 0
    ctx.fillStyle = color
    for (const i of used) {
      const p = landmarks[i]
      if (!p) continue
      const { x, y } = px(p)
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    // Vertical reference through the shoulder midpoint makes lean obvious.
    const ls = landmarks[LM.leftShoulder]
    const rs = landmarks[LM.rightShoulder]
    if (ls && rs) {
      const mid = px({ x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 })
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(mid.x, mid.y)
      ctx.lineTo(mid.x, mid.y - rect.height * 0.35)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [landmarks, postureState, videoRef])

  return (
    <div className={`relative overflow-hidden rounded-card border-2 bg-black ${className}`}
      style={{ borderColor: STATE_COLOR[postureState] }}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-full w-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ transform: 'scaleX(-1)' }}
      />
    </div>
  )
}
