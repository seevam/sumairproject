import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearCalibration, deleteAllData, loadCalibration } from '../lib/db'
import { requestNotificationPermission, notificationPermission } from '../lib/notify'
import { BEHAVIOR_DEFAULT_MODE, MAX_AGE, MIN_AGE, MODE_META, parseAge, useSettings } from '../store/settings'
import { SAME_ORIGIN, detectSameOriginBackend } from '../lib/sync'
import { useSession } from '../store/session'
import { shortDate, shortTime } from '../lib/time'
import type {
  ActivityType,
  BehaviorType,
  CalibrationBaseline,
  Mode,
  NotificationStyle,
  Sensitivity,
} from '../types'

export function Settings() {
  const navigate = useNavigate()
  const settings = useSettings()
  const phase = useSession((s) => s.phase)
  const [baseline, setBaseline] = useState<CalibrationBaseline | null>(null)
  const [notifPerm, setNotifPerm] = useState(notificationPermission())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [localBackend, setLocalBackend] = useState<boolean | null>(null)

  useEffect(() => {
    void loadCalibration().then((c) => setBaseline(c ?? null))
    // Only tells us whether a backend exists on this origin. Nothing is sent
    // anywhere until the user opts in below.
    void detectSameOriginBackend().then(setLocalBackend)
  }, [])

  const sessionRunning = phase !== 'idle' && phase !== 'ended'

  async function toggleStyle(mode: Mode, style: NotificationStyle) {
    const current = settings.modes[mode].notificationStyles
    const has = current.includes(style)
    if (!has && style === 'desktop') {
      setNotifPerm(await requestNotificationPermission())
    }
    settings.updateMode(
      { notificationStyles: has ? current.filter((s) => s !== style) : [...current, style] },
      mode,
    )
  }

  async function handleDeleteAll() {
    await deleteAllData()
    setBaseline(null)
    setConfirmDelete(false)
    navigate('/calibrate')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      {sessionRunning && (
        <p className="card border-warn/40 p-3 text-xs text-warn">
          A session is running. Changes to the break interval apply immediately.
        </p>
      )}

      <Section
        title="Modes"
        hint="Each mode keeps its own settings. Switching modes loads that mode's configuration."
      >
        <div className="flex gap-2" role="group" aria-label="Active mode">
          {(Object.keys(MODE_META) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => settings.setMode(m)}
              aria-pressed={settings.mode === m}
              className={`flex-1 rounded-btn border p-3 text-left transition-colors ${
                settings.mode === m ? 'border-accent bg-accent/10' : 'border-line hover:border-white/30'
              }`}
            >
              <p className="text-sm font-semibold">
                {MODE_META[m].label} Mode
                {settings.mode === m && <span className="ml-2 text-xs font-normal text-accent">active</span>}
              </p>
              <p className="mt-0.5 text-xs tabular text-muted">
                {settings.modes[m].breakIntervalMin} min breaks - {settings.modes[m].sensitivity} sensitivity
              </p>
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted">{MODE_META[settings.mode].blurb}</p>
      </Section>

      {(Object.keys(MODE_META) as Mode[]).map((m) => (
        <ModeEditor
          key={m}
          mode={m}
          isActive={settings.mode === m}
          notifPerm={notifPerm}
          onToggleStyle={(style) => void toggleStyle(m, style)}
        />
      ))}

      <Section title="About you" hint="Used to group results in the study, and to pick sensible defaults.">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="age">Age</label>
            <input
              id="age"
              type="number"
              inputMode="numeric"
              min={MIN_AGE}
              max={MAX_AGE}
              className="input mt-1"
              placeholder="e.g. 16"
              value={settings.profile.age ?? ''}
              onChange={(e) => settings.setProfile({ age: parseAge(e.target.value) })}
            />
          </div>

          <div>
            <span className="label">Behaviour type</span>
            <div className="mt-1 flex gap-2">
              {(['student', 'gamer', 'worker'] as BehaviorType[]).map((b) => (
                <button
                  key={b}
                  onClick={() => settings.applyBehaviorType(b, { switchMode: false })}
                  className={`flex-1 rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                    settings.profile.behaviorType === b
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-line text-muted hover:text-white'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
            {settings.profile.behaviorType && (
              <p className="mt-1 text-xs text-muted">
                {MODE_META[BEHAVIOR_DEFAULT_MODE[settings.profile.behaviorType]].label} Mode is this persona&rsquo;s
                default. Changing it here does not switch your current mode.
              </p>
            )}
          </div>

          <div>
            <span className="label">Preferred activity</span>
            <div className="mt-1 flex gap-2">
              {(['studying', 'gaming', 'working'] as ActivityType[]).map((a) => (
                <button
                  key={a}
                  onClick={() => settings.setProfile({ preferredActivity: a })}
                  className={`flex-1 rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                    settings.profile.preferredActivity === a
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-line text-muted hover:text-white'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Calibration">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-muted">
            {!baseline
              ? 'No baseline captured yet.'
              : baseline.isDefault
                ? 'Using the default posture model.'
                : `Captured ${shortDate(baseline.createdAt)} at ${shortTime(baseline.createdAt)}.`}
          </p>
          <Link to="/calibrate/active" className="btn-secondary">Re-calibrate</Link>
          {baseline && (
            <button
              className="btn-tertiary"
              onClick={async () => {
                await clearCalibration()
                setBaseline(null)
              }}
            >
              Clear
            </button>
          )}
        </div>
      </Section>

      <Section title="Research" hint="Your participant ID is random and is not linked to your name or email.">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="pid">Participant ID</label>
            <input
              id="pid"
              className="input mt-1"
              value={settings.participantId}
              onChange={(e) => settings.update({ participantId: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="api">Session sync (optional)</label>

            {localBackend && (
              <div className="mt-1.5 flex flex-wrap items-center gap-3 rounded-btn border border-line p-3">
                <p className="flex-1 text-xs text-muted">
                  {settings.apiBaseUrl === SAME_ORIGIN
                    ? 'Syncing completed sessions to this deployment\u2019s server.'
                    : 'This deployment includes a research server. Sync is off until you switch it on.'}
                </p>
                {settings.apiBaseUrl === SAME_ORIGIN ? (
                  <button className="btn-tertiary" onClick={() => settings.update({ apiBaseUrl: '' })}>
                    Turn off
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={() => settings.update({ apiBaseUrl: SAME_ORIGIN })}>
                    Sync to this server
                  </button>
                )}
              </div>
            )}

            <input
              id="api"
              className="input mt-2"
              placeholder="https://postureguard-api.example.com"
              value={settings.apiBaseUrl === SAME_ORIGIN ? '' : settings.apiBaseUrl}
              disabled={settings.apiBaseUrl === SAME_ORIGIN}
              onChange={(e) => settings.update({ apiBaseUrl: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted">
              Leave blank to stay fully local - nothing is transmitted at all. When set, only completed-session
              totals and event timestamps are mirrored. Camera frames and pose landmarks never leave this device
              either way.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#4ADE80]"
              checked={settings.showCameraIndicator}
              onChange={(e) => settings.update({ showCameraIndicator: e.target.checked })}
            />
            Show the full &quot;camera active&quot; label, not just the dot
          </label>
        </div>
      </Section>

      <Section title="Privacy and data">
        <div className="space-y-3">
          <p className="text-sm text-muted">
            All camera processing happens on this device. <Link to="/settings/privacy" className="text-accent underline">Read the full statement</Link>
          </p>
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm text-danger">Delete every session, event and calibration on this device?</p>
              <button className="btn-danger" onClick={handleDeleteAll}>Yes, delete everything</button>
              <button className="btn-tertiary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>
          )}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  low: 'Low - only obvious slouching (22%)',
  medium: 'Medium - the PRD default (15%)',
  high: 'High - catches small drifts early (10%)',
}

const DWELL_OPTIONS = [45, 60, 90, 120]

/**
 * Editor for one mode's saved configuration. Both modes are shown at once so
 * the user can set each up in a single visit and then simply toggle between
 * them, rather than having to switch mode before editing it.
 */
function ModeEditor({
  mode,
  isActive,
  notifPerm,
  onToggleStyle,
}: {
  mode: Mode
  isActive: boolean
  notifPerm: NotificationPermission | 'unsupported'
  onToggleStyle: (style: NotificationStyle) => void
}) {
  const settings = useSettings()
  const cfg = settings.modes[mode]

  return (
    <Section
      title={`${MODE_META[mode].label} Mode settings`}
      hint={isActive ? 'Currently active.' : 'Saved - applied when you switch to this mode.'}
    >
      <div className="space-y-4">
        <div>
          <span className="label">Break interval</span>
          <div className="mt-1 flex gap-2">
            {[30, 45, 60].map((min) => (
              <button
                key={min}
                onClick={() => settings.updateMode({ breakIntervalMin: min }, mode)}
                className={`flex-1 rounded-btn border py-2.5 text-sm font-medium transition-colors ${
                  cfg.breakIntervalMin === min
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line text-muted hover:text-white'
                }`}
              >
                {min} min
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Posture sensitivity</span>
          <div className="mt-1 flex gap-2">
            {(['low', 'medium', 'high'] as Sensitivity[]).map((sv) => (
              <button
                key={sv}
                onClick={() => settings.updateMode({ sensitivity: sv }, mode)}
                className={`flex-1 rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                  cfg.sensitivity === sv
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line text-muted hover:text-white'
                }`}
              >
                {sv}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{SENSITIVITY_LABEL[cfg.sensitivity]}</p>
        </div>

        <div>
          <span className="label">Alert after slouching for</span>
          <div className="mt-1 flex gap-2">
            {DWELL_OPTIONS.map((secs) => (
              <button
                key={secs}
                onClick={() => settings.updateMode({ postureAlertSeconds: secs }, mode)}
                className={`flex-1 rounded-btn border py-2.5 text-sm font-medium transition-colors ${
                  cfg.postureAlertSeconds === secs
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line text-muted hover:text-white'
                }`}
              >
                {secs}s
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Alert channels</span>
          <div className="mt-1 space-y-2">
            {([
              { key: 'visual', label: 'In-app badge', detail: 'Posture pill turns amber, then red.' },
              { key: 'audio', label: 'Audio cue', detail: 'Short chime. Quieter in Study Mode.' },
              { key: 'desktop', label: 'Desktop notification', detail: 'Reaches you if the window is minimised.' },
            ] as Array<{ key: NotificationStyle; label: string; detail: string }>).map((opt) => (
              <label
                key={opt.key}
                className="flex cursor-pointer items-start gap-3 rounded-btn border border-line p-3"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[#4ADE80]"
                  checked={cfg.notificationStyles.includes(opt.key)}
                  onChange={() => onToggleStyle(opt.key)}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted">{opt.detail}</span>
                  {opt.key === 'desktop' && notifPerm === 'denied' && (
                    <span className="mt-1 block text-xs text-danger">Blocked in browser site settings.</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}
