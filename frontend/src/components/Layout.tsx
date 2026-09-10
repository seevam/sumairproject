import { NavLink, Outlet } from 'react-router-dom'
import { CameraIndicator } from './CameraIndicator'
import { DevPanel } from './DevPanel'
import { useSession } from '../store/session'

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
          <NavLink to="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm text-[#04140A]">P</span>
            PostureGuard
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

          <div className="ml-auto">
            <CameraIndicator active={cameraActive} />
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
