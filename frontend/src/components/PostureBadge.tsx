import type { PostureState } from '../types'

const STYLES: Record<PostureState, { label: string; className: string }> = {
  good: { label: 'Good posture', className: 'bg-accent/15 text-accent border-accent/40' },
  warning: { label: 'Posture drifting', className: 'bg-warn/15 text-warn border-warn/40' },
  poor: { label: 'Poor posture', className: 'bg-danger/15 text-danger border-danger/50' },
  absent: { label: 'Not detected', className: 'bg-white/5 text-muted border-line' },
}

export function PostureBadge({ state, deviationPct }: { state: PostureState; deviationPct?: number }) {
  const style = STYLES[state]
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${style.className}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
      {style.label}
      {deviationPct !== undefined && state !== 'absent' && (
        <span className="tabular font-normal opacity-70">{deviationPct.toFixed(0)}%</span>
      )}
    </span>
  )
}
