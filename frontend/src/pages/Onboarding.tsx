import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  Bell,
  Camera,
  ChevronRight,
  Clock,
  Crosshair,
  Check,
} from 'lucide-react'
import { useEffect } from 'react'
import { MODE_PRESETS, useSettings } from '../store/settings'
import { useOnboarding } from '../store/onboarding'
import type { ActivityType, NotificationStyle, Sensitivity } from '../types'

const TOTAL = 4

export function Onboarding() {
  const { step } = useParams<{ step: string }>()
  const navigate = useNavigate()
  const complete = useOnboarding((s) => s.complete)
  const enter = useOnboarding((s) => s.enter)

  const current = Number(step)
  const valid = Number.isInteger(current) && current >= 1 && current <= TOTAL

  useEffect(() => {
    // Reaching onboarding at all means the user is past the entry screen.
    enter()
    if (!valid) navigate('/onboarding/1', { replace: true })
  }, [valid, navigate, enter])

  if (!valid) return null

  const next = () => {
    if (current < TOTAL) navigate(`/onboarding/${current + 1}`)
    else {
      complete()
      navigate('/calibrate')
    }
  }

  const skip = () => {
    complete()
    navigate('/calibrate')
  }

  return (
    <div className="wave-foot mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col px-4 py-8">
      <ProgressBar step={current} />

      <div className="flex flex-1 flex-col">
        {current === 1 && <StepWelcome />}
        {current === 2 && <StepHowItWorks />}
        {current === 3 && <StepPersonalise />}
        {current === 4 && <StepReady />}
      </div>

      <div className="space-y-2 pt-6">
        <button className="btn-primary w-full" onClick={next}>
          {current === TOTAL ? 'Start Calibration' : 'Next'}
        </button>
        <button className="btn-tertiary w-full" onClick={skip}>
          {current === TOTAL ? 'Skip for Now' : 'Skip'}
        </button>
      </div>
    </div>
  )
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-8 space-y-2">
      <p className="text-xs font-medium text-muted">
        {step} / {TOTAL}
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${(step / TOTAL) * 100}%` }}
        />
      </div>
    </div>
  )
}

function StepWelcome() {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold leading-tight tracking-tight">
        Welcome to PostureGuard
      </h1>
      <p className="leading-relaxed text-muted">
        Monitor your desk habits, understand your sitting patterns, and build healthier work
        habits.
      </p>

      <div className="card grid place-items-center px-6 py-10">
        <DeskIllustration />
      </div>
    </div>
  )
}

const HOW_IT_WORKS = [
  { icon: Camera, title: 'Monitor', body: 'Your camera analyses your position while you work.' },
  { icon: Crosshair, title: 'Detect', body: 'The system identifies prolonged sitting and changes in posture.' },
  { icon: Bell, title: 'Notify', body: "You'll receive subtle reminders when it's time to adjust or take a break." },
  { icon: BarChart3, title: 'Learn', body: 'Review your data to understand your habits over time.' },
]

function StepHowItWorks() {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold tracking-tight">How It Works</h1>
      <ul className="space-y-3">
        {HOW_IT_WORKS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="card flex gap-4 p-4">
            <span className="icon-tile">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepPersonalise() {
  const settings = useSettings()

  const activities: ActivityType[] = ['studying', 'gaming', 'working']
  const sensitivities: Sensitivity[] = ['low', 'medium', 'high']
  const intervals = [30, 45, 60]

  const styleSummary = settings.notificationStyles.length
    ? settings.notificationStyles
        .map((s) => ({ visual: 'In-app', audio: 'Sound', desktop: 'Desktop' })[s])
        .join(', ')
    : 'None selected'

  const cycleStyles = () => {
    // Walks the useful combinations rather than every subset.
    const options: NotificationStyle[][] = [
      ['visual', 'audio', 'desktop'],
      ['visual', 'desktop'],
      ['visual', 'audio'],
      ['visual'],
    ]
    const i = options.findIndex(
      (o) => o.join() === [...settings.notificationStyles].sort().join(),
    )
    settings.update({ notificationStyles: options[(i + 1) % options.length] })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Personalize Your Experience</h1>
        <p className="text-sm leading-relaxed text-muted">
          Choose a few preferences to get the most out of PostureGuard.
        </p>
      </div>

      <div className="space-y-2.5">
        <PrefRow
          icon={Activity}
          title="Activity Type"
          value={settings.activityType}
          onClick={() => {
            const i = activities.indexOf(settings.activityType)
            const nextActivity = activities[(i + 1) % activities.length]
            settings.update({ activityType: nextActivity })
            // Gaming maps to the more insistent preset, studying to the quieter one.
            settings.setMode(nextActivity === 'gaming' ? 'entertainment' : 'study')
          }}
        />
        <PrefRow
          icon={Bell}
          title="Notification Style"
          value={styleSummary}
          onClick={cycleStyles}
        />
        <PrefRow
          icon={Clock}
          title="Break Interval"
          value={`${settings.breakIntervalMin} min`}
          onClick={() => {
            const i = intervals.indexOf(settings.breakIntervalMin)
            settings.update({ breakIntervalMin: intervals[(i + 1) % intervals.length] })
          }}
        />
        <PrefRow
          icon={Crosshair}
          title="Posture Sensitivity"
          value={settings.sensitivity}
          onClick={() => {
            const i = sensitivities.indexOf(settings.sensitivity)
            settings.update({ sensitivity: sensitivities[(i + 1) % sensitivities.length] })
          }}
        />
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {MODE_PRESETS[settings.mode].label} Mode - {MODE_PRESETS[settings.mode].blurb} You can
        change any of this later in Settings.
      </p>
    </div>
  )
}

function PrefRow({
  icon: Icon,
  title,
  value,
  onClick,
}: {
  icon: typeof Activity
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-accent/40"
    >
      <span className="icon-tile h-9 w-9">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs capitalize text-muted">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
    </button>
  )
}

function StepReady() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">You&rsquo;re All Set!</h1>
        <p className="text-sm leading-relaxed text-muted">
          Let&rsquo;s calibrate your setup so we can accurately track your posture and sitting
          patterns.
        </p>
      </div>

      <div className="card grid place-items-center px-6 py-12">
        <div className="relative">
          <div className="grid h-32 w-32 place-items-center rounded-full bg-accent/5 ring-1 ring-accent/20">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-accent/10 ring-1 ring-accent/25">
              <Camera className="h-10 w-10 text-accent" />
            </div>
          </div>
          <span className="absolute bottom-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-accent text-[#04140A]">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        </div>
      </div>
    </div>
  )
}

/** Line-art figure at a desk, echoing the mockup's welcome illustration. */
function DeskIllustration() {
  return (
    <svg viewBox="0 0 200 140" className="h-36 w-full text-accent" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="112" y="38" width="56" height="38" rx="3" strokeOpacity="0.9" />
        <path d="M140 76v8m-10 0h20" strokeOpacity="0.9" />
        <path d="M36 112h140" strokeOpacity="0.5" />
        <path d="M52 112V92h72v20" strokeOpacity="0.5" />
        <circle cx="78" cy="44" r="11" />
        <path d="M60 88c0-12 8-20 18-20s18 8 18 20" />
        <path d="M96 84h18" strokeOpacity="0.8" />
        <path d="M62 112v16m32-16v16" strokeOpacity="0.6" />
      </g>
      <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round">
        <path d="M96 50l14-6m-14 12l14 0m-14 12l14 6" />
      </g>
      <g stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round">
        <path d="M178 112V96m0 0c6 0 9-4 9-9-6 0-9 4-9 9Zm0 0c-6 0-9-4-9-9 6 0 9 4 9 9Z" />
      </g>
    </svg>
  )
}
