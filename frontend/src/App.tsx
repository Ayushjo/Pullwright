import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewTask from './pages/NewTask'
import TaskView from './pages/TaskView'
import History from './pages/History'
import Replay from './pages/Replay'
import Settings from './pages/Settings'
import Pricing from './pages/Pricing'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './components/ui'
import RouteGuard from './components/RouteGuard'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
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
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
