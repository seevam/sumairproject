import { useEffect, useState } from 'react'
import { useSession } from '../store/session'
import { useSettings } from '../store/settings'

const STORAGE_KEY = 'postureguard:devmode'

/**
 * Test harness for demos and QA (not part of the participant-facing product).
 *
 * It exists because the behaviours worth demonstrating are on 30-90 second and
 * 30-45 minute timescales. Rather than wait out a real break interval, this
 * scales the clock and lets you pin the posture signal to a chosen value.
 *
 * Toggle with Ctrl+Shift+D, or open any URL with ?dev=1. The choice is
 * remembered so a demo survives a reload.
 */
export function DevPanel() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).has('dev')) return true
    return localStorage.getItem(STORAGE_KEY) === '1'
  })
  const [open, setOpen] = useState(true)

  const s = useSession()
  const settings = useSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setEnabled((v) => {
          localStorage.setItem(STORAGE_KEY, v ? '0' : '1')
          return !v
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Leaving a forced value pinned after closing the panel would silently
  // corrupt a real session, so clear the overrides on the way out.
  useEffect(() => {
    if (!enabled) {
      s.setForcedDeviation(null)
      s.setForcedAbsent(false)
      s.setTimeScale(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Expose the engine for automated tests and console poking, but only while
  // dev mode is on - it is never reachable in a participant's session.
  useEffect(() => {
    const w = window as unknown as { __pgSession?: typeof useSession }
    if (enabled) w.__pgSession = useSession
    else delete w.__pgSession
  }, [enabled])

  if (!enabled) return null

  const scales = [1, 10, 60, 300]

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-card border border-warn/50 bg-[#141001] text-xs shadow-2xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 font-semibold text-warn"
      >
        <span>Dev / test mode</span>
        <span className="text-muted">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-warn/30 px-3 py-3">
          <div>
            <div className="label mb-1.5">Clock speed</div>
            <div className="flex gap-1">
              {scales.map((v) => (
                <button
                  key={v}
                  onClick={() => s.setTimeScale(v)}
                  className={`flex-1 rounded-input px-2 py-1.5 font-semibold ${
                    s.timeScale === v ? 'bg-warn text-black' : 'bg-white/5 text-muted hover:text-white'
                  }`}
                >
                  {v}x
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              At 60x a {settings.active().breakIntervalMin}-minute break interval arrives in{' '}
              {settings.active().breakIntervalMin}s.
            </p>
          </div>

          <div>
            <div className="label mb-1.5">Force deviation</div>
            <div className="flex gap-1">
              {[
                { label: 'off', value: null },
                { label: 'good 4%', value: 4 },
                { label: 'warn 18%', value: 18 },
                { label: 'poor 40%', value: 40 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => s.setForcedDeviation(opt.value)}
                  className={`flex-1 rounded-input px-1.5 py-1.5 ${
                    s.forcedDeviation === opt.value ? 'bg-warn text-black' : 'bg-white/5 text-muted hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between">
            <span className="label">Simulate user away</span>
            <input
              type="checkbox"
              checked={s.forcedAbsent}
              onChange={(e) => s.setForcedAbsent(e.target.checked)}
              className="h-4 w-4 accent-[#F0A500]"
            />
          </label>

          <button
            onClick={s.forceBreakPrompt}
            disabled={s.phase !== 'active'}
            className="w-full rounded-input bg-white/5 py-1.5 font-semibold text-white hover:bg-white/10 disabled:opacity-40"
          >
            Trigger break prompt now
          </button>

          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 border-t border-warn/20 pt-2 text-[10px] text-muted">
            <dt>phase</dt><dd className="text-right text-white">{s.phase}</dd>
            <dt>sitting</dt><dd className="tabular text-right text-white">{Math.round(s.sittingSeconds)}s</dd>
            <dt>sustained</dt><dd className="tabular text-right text-white">{Math.round(s.sustainedSeconds)}s</dd>
            <dt>deviation</dt><dd className="tabular text-right text-white">{s.deviationPct.toFixed(1)}%</dd>
            <dt>present</dt><dd className="text-right text-white">{String(s.present)}</dd>
            <dt>absent for</dt><dd className="tabular text-right text-white">{Math.round(s.absentSeconds)}s</dd>
          </dl>

          <p className="text-[10px] leading-relaxed text-muted">
            Ctrl+Shift+D to hide. Overrides reset when hidden.
          </p>
        </div>
      )}
    </div>
  )
}
