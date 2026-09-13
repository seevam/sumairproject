import { NavLink, Outlet } from 'react-router-dom'
import { CameraIndicator } from './CameraIndicator'
import { DevPanel } from './DevPanel'
import { LogoMark, Wordmark } from './Logo'
import { useSession } from '../store/session'
import { useAuthState } from '../auth/useAuthState'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/data', label: 'Data' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const phase = useSession((s) => s.phase)
  const cameraActive = phase === 'active' || phase === 'break_prompt' || phase === 'break'

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <NavLink to="/dashboard" className="flex items-center gap-2">
            <LogoMark className="h-6 w-6 text-accent" />
            <Wordmark className="text-base" />
          </NavLink>

          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-btn px-3 py-1.5 transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'text-muted hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <CameraIndicator active={cameraActive} />
            <AccountChip />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>

      <DevPanel />
    </div>
  )
}

/**
 * Shows who is signed in, or nothing at all in guest-only builds. Guest is the
 * normal state here, so it is labelled plainly rather than as a prompt to
 * upgrade.
 */
function AccountChip() {
  const auth = useAuthState()
  if (!auth.available) return null

  if (!auth.signedIn) {
    return <NavLink to="/auth" className="text-xs text-muted hover:text-white">Guest</NavLink>
  }

  return (
    <button
      onClick={() => void auth.signOut()}
      title={auth.email ?? undefined}
      className="max-w-[12rem] truncate text-xs text-muted hover:text-white"
    >
      {auth.email ?? 'Signed in'} - Sign out
    </button>
  )
}
