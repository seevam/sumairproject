import { Suspense, lazy, type ReactNode } from 'react'
import { authAvailable } from './config'

const ClerkGate = lazy(() => import('./ClerkGate'))

/**
 * Mounts Clerk only when a key is configured. Without one the children render
 * directly against the default guest context, and the Clerk chunk is never
 * requested.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!authAvailable()) return <>{children}</>

  return (
    <Suspense fallback={<BootScreen />}>
      <ClerkGate>{children}</ClerkGate>
    </Suspense>
  )
}

function BootScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <p className="text-sm text-muted">Loading PostureGuard...</p>
    </div>
  )
}
