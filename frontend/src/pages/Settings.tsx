import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearCalibration, deleteAllData, loadCalibration } from '../lib/db'
import { requestNotificationPermission, notificationPermission } from '../lib/notify'
import { MODE_PRESETS, useSettings } from '../store/settings'
import { SAME_ORIGIN, detectSameOriginBackend } from '../lib/sync'
import { useSession } from '../store/session'
import { shortDate, shortTime } from '../lib/time'
import type { ActivityType, CalibrationBaseline, Mode, NotificationStyle, Sensitivity } from '../types'

const SENSITIVITY_HELP: Record<Sensitivity, string> = {
  low: 'Alerts only on obvious slouching (22% deviation).',
  medium: 'The PRD default (15% deviation).',
  high: 'Catches small drifts early (10% deviation). More alerts.',
}

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

  async function toggleStyle(style: NotificationStyle) {
    const has = settings.notificationStyles.includes(style)
    if (!has && style === 'desktop') {
      setNotifPerm(await requestNotificationPermission())
    }
    settings.update({
      notificationStyles: has
        ? settings.notificationStyles.filter((s) => s !== style)
        : [...settings.notificationStyles, style],
    })
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

      <Section title="Mode" hint="Sets both the break interval and how long slouching is tolerated.">
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(MODE_PRESETS) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => settings.setMode(m)}
              className={`rounded-btn border p-3 text-left transition-colors ${
                settings.mode === m ? 'border-accent bg-accent/10' : 'border-line hover:border-white/30'
              }`}
            >
              <p className="text-sm font-semibold">{MODE_PRESETS[m].label} Mode</p>
              <p className="mt-0.5 text-xs text-muted">{MODE_PRESETS[m].blurb}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Break interval" hint="Overrides the mode default if you want a different pace.">
        <div className="flex gap-2">
          {[30, 45, 60].map((min) => (
            <button
              key={min}
              onClick={() => settings.update({ breakIntervalMin: min })}
              className={`flex-1 rounded-btn border py-2.5 text-sm font-medium transition-colors ${
                settings.breakIntervalMin === min ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'
              }`}
            >
              {min} min
            </button>
          ))}
        </div>
      </Section>

      <Section title="Posture sensitivity" hint={SENSITIVITY_HELP[settings.sensitivity]}>
        <div className="flex gap-2">
          {(['low', 'medium', 'high'] as Sensitivity[]).map((s) => (
            <button
              key={s}
              onClick={() => settings.update({ sensitivity: s })}
              className={`flex-1 rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                settings.sensitivity === s ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Alert channels" hint="Visual alerts are always on while the dashboard is open.">
        <div className="space-y-2">
          {([
            { key: 'visual', label: 'In-app badge', detail: 'Posture pill turns amber, then red.' },
            { key: 'audio', label: 'Audio cue', detail: 'Short chime. Quieter in Study Mode.' },
            { key: 'desktop', label: 'Desktop notification', detail: 'Reaches you if the window is minimised.' },
          ] as Array<{ key: NotificationStyle; label: string; detail: string }>).map((opt) => (
            <label key={opt.key} className="flex cursor-pointer items-start gap-3 rounded-btn border border-line p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#4ADE80]"
                checked={settings.notificationStyles.includes(opt.key)}
                onChange={() => void toggleStyle(opt.key)}
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
      </Section>

      <Section title="Activity type" hint="Recorded with your sessions for the study.">
        <div className="flex gap-2">
          {(['studying', 'gaming', 'working'] as ActivityType[]).map((a) => (
            <button
              key={a}
              onClick={() => settings.update({ activityType: a })}
              className={`flex-1 rounded-btn border py-2.5 text-sm font-medium capitalize transition-colors ${
                settings.activityType === a ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'
              }`}
            >
              {a}
            </button>
          ))}
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
