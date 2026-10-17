import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewTask from './pages/NewTask'
import Pool from './pages/Pool'
import Analytics from './pages/Analytics'
import TaskView from './pages/TaskView'
import History from './pages/History'
import Replay from './pages/Replay'
import Settings from './pages/Settings'
import Wallet from './pages/Wallet'
import Pricing from './pages/Pricing'
import { AuthProvider, useAuth } from './context/AuthContext'
import { identifyUser, installAnalytics, trackPageView } from './lib/analytics'
import { ToastProvider } from './components/ui'
import RouteGuard from './components/RouteGuard'

/** Page views on every route change (after the page has set its title) and identify after sign-in. */
function AnalyticsTracker() {
  const { pathname } = useLocation()
  const { user, loading } = useAuth()
  useEffect(() => installAnalytics(), [])
  useEffect(() => {
    if (loading) return
    identifyUser(user?.login ?? null)
  }, [user?.login, loading])
  useEffect(() => {
    if (loading) return
    const t = setTimeout(trackPageView, 50)
    return () => clearTimeout(t)
  }, [pathname, loading])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AnalyticsTracker />
          <Routes>
            <Route path="/"          element={<Home />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/dashboard" element={<RouteGuard><Dashboard /></RouteGuard>} />
            <Route path="/history"   element={<RouteGuard><History /></RouteGuard>} />
            <Route path="/tasks/new" element={<RouteGuard><NewTask /></RouteGuard>} />
            <Route path="/tasks/:id" element={<RouteGuard><TaskView /></RouteGuard>} />
            <Route path="/r/:id"     element={<Replay />} />
            <Route path="/pricing"   element={<Pricing />} />
            <Route path="/settings"  element={<RouteGuard><Settings /></RouteGuard>} />
            <Route path="/wallet"    element={<RouteGuard><Wallet /></RouteGuard>} />
            <Route path="/admin/pool" element={<RouteGuard><Pool /></RouteGuard>} />
            <Route path="/admin/analytics" element={<RouteGuard><Analytics /></RouteGuard>} />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
