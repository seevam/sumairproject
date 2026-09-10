export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'accent' | 'warn' | 'danger'
}) {
  const toneClass = {
    default: 'text-white',
    accent: 'text-accent',
    warn: 'text-warn',
    danger: 'text-danger',
  }[tone]

  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className={`tabular mt-1.5 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}
