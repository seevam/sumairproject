/** Leaf mark plus wordmark, as in the V1 mockup. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path
        d="M16 29V15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 16c0-5 3.6-9.2 9-10-.6 5.6-3.8 9.4-9 10Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <path
        d="M16 19c0-4.4-3.2-8.2-8-9 .5 5 3.4 8.4 8 9Z"
        fill="currentColor"
        fillOpacity="0.55"
      />
    </svg>
  )
}

export function Wordmark({ className = 'text-2xl' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      Posture<span className="text-accent">Guard</span>
    </span>
  )
}

export function LogoLockup({ tagline = false }: { tagline?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <LogoMark className="h-10 w-10 text-accent" />
      <Wordmark className="text-2xl" />
      {tagline && <p className="text-sm text-muted">Better habits. Healthier you.</p>}
    </div>
  )
}
