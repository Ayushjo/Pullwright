import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getMe, githubLoginUrl, logout as apiLogout, type AuthUser } from '../api/client'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  login: (returnTo?: string) => void
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const u = await getMe()
    setUser(u)
    setLoading(false)
  }

  useEffect(() => {
    void getMe().then((u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const login = (returnTo?: string) => {
    window.location.href = githubLoginUrl(returnTo ?? window.location.pathname)
  }

  const logout = async () => {
    await apiLogout()
    setUser(null)
  }

  return (
    <Ctx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  )
}
