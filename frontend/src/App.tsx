import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Auth } from './pages/Auth'
import { Onboarding } from './pages/Onboarding'
import { Calibrate } from './pages/Calibrate'
import { CalibrateActive } from './pages/CalibrateActive'
import { Dashboard } from './pages/Dashboard'
import { BreakPrompt } from './pages/BreakPrompt'
import { BreakActive } from './pages/BreakActive'
import { SessionSummary } from './pages/SessionSummary'
import { Data } from './pages/Data'
import { Settings } from './pages/Settings'
import { Privacy } from './pages/Privacy'
import { recoverOrphanedSessions, startHeartbeat, stopHeartbeat, useSession } from './store/session'
import { useOnboarding } from './store/onboarding'
import { setAuthTokenProvider, syncPending } from './lib/sync'
import { useAuthState } from './auth/useAuthState'

export default function App() {
  const auth = useAuthState()

  // Sync requests carry a bearer token only while signed in; guests sync
  // anonymously, which is what the backend's default mode expects.
  useEffect(() => {
    setAuthTokenProvider(auth.signedIn ? auth.getToken : null)
    return () => setAuthTokenProvider(null)
  }, [auth.signedIn, auth.getToken])

  useEffect(() => {
    startHeartbeat()
    // Close any session a previous page load never ended (crash, dead battery),
    // then push everything unsynced. Failures are silent by design.
    void recoverOrphanedSessions()
      .catch(() => 0)
      .then(() => syncPending())
    return stopHeartbeat
  }, [])

  // Ending the tab mid-session would otherwise lose the session entirely.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        const { phase, end } = useSession.getState()
        if (phase === 'active' || phase === 'break' || phase === 'break_prompt') void end()
      }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  return (
    <Routes>
      {/* Full-bleed screens: no app chrome until the user is through the intro. */}
      <Route path="/auth" element={<Auth />} />
      <Route path="/onboarding/:step" element={<Onboarding />} />
      <Route path="/onboarding" element={<Navigate to="/onboarding/1" replace />} />

      <Route element={<Layout />}>
        <Route index element={<Entry />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/calibrate" element={<Calibrate />} />
        <Route path="/calibrate/active" element={<CalibrateActive />} />
        <Route path="/session/break" element={<BreakPrompt />} />
        <Route path="/session/break/active" element={<BreakActive />} />
        <Route path="/session/summary" element={<SessionSummary />} />
        <Route path="/data" element={<Data />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/privacy" element={<Privacy />} />
        <Route path="*" element={<Entry />} />
      </Route>
    </Routes>
  )
}

/**
 * Decides where a visitor lands.
 *
 * Nothing here is a security boundary - PostureGuard is guest-first and every
 * screen works without an account. This only avoids showing the intro to
 * someone who has already been through it.
 */
function Entry() {
  const { entered, completed } = useOnboarding()
  const location = useLocation()

  if (!entered) return <Navigate to="/auth" replace />
  if (!completed) return <Navigate to="/onboarding/1" replace />
  if (location.pathname !== '/dashboard') return <Navigate to="/dashboard" replace />
  return <Dashboard />
}
