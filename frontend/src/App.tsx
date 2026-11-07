import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Pricing from './pages/Pricing'
import Privacy from './pages/Privacy'
// Public, prerendered pages load with the bundle; app pages load on demand.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NewTask = lazy(() => import('./pages/NewTask'))
const Pool = lazy(() => import('./pages/Pool'))
const Analytics = lazy(() => import('./pages/Analytics'))
const TaskView = lazy(() => import('./pages/TaskView'))
const DemoTask = lazy(() => import('./pages/TaskView').then((m) => ({ default: m.DemoTaskRoute })))
const Demo = lazy(() => import('./pages/Demo'))
const History = lazy(() => import('./pages/History'))
const Replay = lazy(() => import('./pages/Replay'))
const Settings = lazy(() => import('./pages/Settings'))
const Wallet = lazy(() => import('./pages/Wallet'))
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
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
          <Routes>
            <Route path="/"          element={<Home />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/dashboard" element={<RouteGuard><Dashboard /></RouteGuard>} />
            <Route path="/history"   element={<RouteGuard><History /></RouteGuard>} />
            <Route path="/tasks/new" element={<RouteGuard><NewTask /></RouteGuard>} />
            <Route path="/tasks/:id" element={<RouteGuard><TaskView /></RouteGuard>} />
            <Route path="/r/:id"     element={<Replay />} />
            <Route path="/demo"      element={<Demo />} />
            <Route path="/demo/:id"  element={<DemoTask />} />
            <Route path="/pricing"   element={<Pricing />} />
            <Route path="/privacy"   element={<Privacy />} />
            <Route path="/settings"  element={<RouteGuard><Settings /></RouteGuard>} />
            <Route path="/wallet"    element={<RouteGuard><Wallet /></RouteGuard>} />
            <Route path="/admin/pool" element={<RouteGuard><Pool /></RouteGuard>} />
            <Route path="/admin/analytics" element={<RouteGuard><Analytics /></RouteGuard>} />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
