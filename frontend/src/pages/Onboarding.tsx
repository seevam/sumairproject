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
import { BEHAVIOR_DEFAULT_MODE, MODE_META, useSettings } from '../store/settings'
import { useOnboarding } from '../store/onboarding'
import type { ActivityType, BehaviorType, NotificationStyle, Sensitivity } from '../types'

const TOTAL = 5

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
        {current === 3 && <StepAboutYou />}
        {current === 4 && <StepPersonalise />}
        {current === 5 && <StepReady />}
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

function StepAboutYou() {
  const settings = useSettings()
  const { profile } = settings

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">About You</h1>
        <p className="text-sm leading-relaxed text-muted">
          Three quick details. They set your starting mode and are recorded with your sessions so
          results can be grouped by age and persona.
        </p>
      </div>

      <div className="card space-y-2 p-4">
        <label className="label" htmlFor="ob-age">Age</label>
        <input
          id="ob-age"
          type="number"
          inputMode="numeric"
          min={5}
          max={120}
          className="input"
          placeholder="e.g. 16"
          value={profile.age ?? ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            settings.setProfile({ age: e.target.value === '' || Number.isNaN(n) ? null : n })
          }}
        />
        <p className="text-xs leading-relaxed text-muted">
          Used to pick a starting posture model if you skip calibration, and as a grouping variable
          in the study. Calibrating replaces the estimate with your own measurements.
        </p>
      </div>

      <div className="card space-y-2 p-4">
        <span className="label">Behaviour type</span>
        <div className="grid grid-cols-3 gap-2">
          {(['student', 'gamer', 'worker'] as BehaviorType[]).map((b) => (
            <button
              key={b}
              onClick={() => settings.applyBehaviorType(b)}
              aria-pressed={profile.behaviorType === b}
              className={`rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                profile.behaviorType === b
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-muted hover:text-white'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          {profile.behaviorType
            ? `Starts you in ${MODE_META[BEHAVIOR_DEFAULT_MODE[profile.behaviorType]].label} Mode. You can switch any time.`
            : 'Sets which mode you start in.'}
        </p>
      </div>

      <div className="card space-y-2 p-4">
        <span className="label">Preferred activity</span>
        <div className="grid grid-cols-3 gap-2">
          {(['studying', 'gaming', 'working'] as ActivityType[]).map((a) => (
            <button
              key={a}
              onClick={() => settings.setProfile({ preferredActivity: a })}
              aria-pressed={profile.preferredActivity === a}
              className={`rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                profile.preferredActivity === a
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-muted hover:text-white'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          What you are usually doing at this desk. Recorded with each session.
        </p>
      </div>
    </div>
  )
}

function StepPersonalise() {
  const settings = useSettings()
  const cfg = settings.active()

  const sensitivities: Sensitivity[] = ['low', 'medium', 'high']
  const intervals = [30, 45, 60]

  const styleSummary = cfg.notificationStyles.length
    ? cfg.notificationStyles
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
    const i = options.findIndex((o) => o.join() === [...cfg.notificationStyles].sort().join())
    settings.updateMode({ notificationStyles: options[(i + 1) % options.length] })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Personalize Your Experience</h1>
        <p className="text-sm leading-relaxed text-muted">
          These settings belong to {MODE_META[settings.mode].label} Mode. The other mode keeps its
          own, so switching modes brings its configuration with it.
        </p>
      </div>

      <div className="space-y-2.5">
        <PrefRow
          icon={Bell}
          title="Notification Style"
          value={styleSummary}
          onClick={cycleStyles}
        />
        <PrefRow
          icon={Clock}
          title="Break Interval"
          value={`${cfg.breakIntervalMin} min`}
          onClick={() => {
            const i = intervals.indexOf(cfg.breakIntervalMin)
            settings.updateMode({ breakIntervalMin: intervals[(i + 1) % intervals.length] })
          }}
        />
        <PrefRow
          icon={Crosshair}
          title="Posture Sensitivity"
          value={cfg.sensitivity}
          onClick={() => {
            const i = sensitivities.indexOf(cfg.sensitivity)
            settings.updateMode({ sensitivity: sensitivities[(i + 1) % sensitivities.length] })
          }}
        />
        <PrefRow
          icon={Activity}
          title="Mode"
          value={`${MODE_META[settings.mode].label} - tap to switch`}
          onClick={() => settings.setMode(settings.mode === 'study' ? 'entertainment' : 'study')}
        />
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {MODE_META[settings.mode].blurb} You can fine-tune both modes later in Settings.
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
