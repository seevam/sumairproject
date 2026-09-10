import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Calibrate } from './pages/Calibrate'
import { CalibrateActive } from './pages/CalibrateActive'
import { Dashboard } from './pages/Dashboard'
import { BreakPrompt } from './pages/BreakPrompt'
import { BreakActive } from './pages/BreakActive'
import { SessionSummary } from './pages/SessionSummary'
import { Data } from './pages/Data'
import { Settings } from './pages/Settings'
import { Privacy } from './pages/Privacy'
import { startHeartbeat, stopHeartbeat, useSession } from './store/session'
import { syncPending } from './lib/sync'

export default function App() {
  useEffect(() => {
    startHeartbeat()
    // Push anything a previous run left unsynced; failures are silent by design.
    void syncPending()
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
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/calibrate" element={<Calibrate />} />
        <Route path="/calibrate/active" element={<CalibrateActive />} />
        <Route path="/session/break" element={<BreakPrompt />} />
        <Route path="/session/break/active" element={<BreakActive />} />
        <Route path="/session/summary" element={<SessionSummary />} />
        <Route path="/data" element={<Data />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/privacy" element={<Privacy />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
