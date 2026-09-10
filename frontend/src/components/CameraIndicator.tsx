import { useSettings } from '../store/settings'

/**
 * Always-visible proof that the camera is on (US-31). Deliberately not
 * dismissable while a stream is live - the toggle in Settings only controls
 * whether the label text is shown alongside the dot.
 */
export function CameraIndicator({ active }: { active: boolean }) {
  const showLabel = useSettings((s) => s.showCameraIndicator)
  if (!active) return null
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
      <span className="rec-dot h-2 w-2 rounded-full bg-accent" />
      {showLabel ? 'Camera active - processed on this device' : 'Camera active'}
    </span>
  )
}
