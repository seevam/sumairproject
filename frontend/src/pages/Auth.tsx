import { Suspense, lazy, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { LogoLockup } from '../components/Logo'
import { useAuthState } from '../auth/useAuthState'

const ClerkForms = lazy(() => import('../auth/ClerkForms'))
import { useOnboarding } from '../store/onboarding'

type Tab = 'login' | 'signup'

/**
 * Entry screen. Guest is a first-class path, not a fallback: everything in
 * PostureGuard works without an account, and signing in only adds cross-device
 * sync. When no Clerk key is configured the form is replaced by an explanation
 * so the screen never presents inputs that cannot work.
 */
export function Auth() {
  const navigate = useNavigate()
  const auth = useAuthState()
  const enterGuest = useOnboarding((s) => s.enter)
  const [tab, setTab] = useState<Tab>('login')

  function continueAsGuest() {
    enterGuest()
    navigate('/onboarding/1')
  }

  return (
    <div className="wave-foot mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col justify-center gap-6 px-4 py-8">
      <LogoLockup tagline />

      <div className="card overflow-hidden">
        {auth.available ? (
          <>
            <div className="grid grid-cols-2 border-b border-line" role="tablist">
              {(['login', 'signup'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`relative py-3.5 text-sm font-semibold transition-colors ${
                    tab === t ? 'text-accent' : 'text-muted hover:text-white'
                  }`}
                >
                  {t === 'login' ? 'Log In' : 'Sign Up'}
                  {tab === t && (
                    <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              ))}
            </div>

            {/* Clerk renders and validates the real form; the tabs above just
                pick which one, so the visual shell stays ours. */}
            <div className="flex justify-center px-2 py-4">
              <Suspense fallback={<p className="py-8 text-sm text-muted">Loading sign-in...</p>}>
                <ClerkForms mode={tab} />
              </Suspense>
            </div>
          </>
        ) : (
          <InertForm />
        )}

        <div className="space-y-4 border-t border-line px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs text-muted">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <button className="btn-secondary w-full" onClick={continueAsGuest}>
            Continue as Guest
          </button>

          <p className="text-center text-xs leading-relaxed text-muted">
            Guest mode is fully featured. Your posture data stays on this device and can be
            exported at any time. An account only adds syncing across devices.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Shown when the build has no Clerk key. Deliberately non-interactive: offering
 * a login form that cannot submit would be worse than explaining why.
 */
function InertForm() {
  const [reveal, setReveal] = useState(false)

  return (
    <div className="space-y-3 px-6 py-6" aria-describedby="auth-unavailable">
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className="input pl-10" placeholder="Email address" disabled />
      </div>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input px-10"
          type={reveal ? 'text' : 'password'}
          placeholder="Password"
          disabled
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white"
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <p id="auth-unavailable" className="rounded-btn border border-line bg-surface-2 p-3 text-xs leading-relaxed text-muted">
        Accounts are not enabled on this deployment. Continue as a guest below - every feature
        works without one.
      </p>
    </div>
  )
}
