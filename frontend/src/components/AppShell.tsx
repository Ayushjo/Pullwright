import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { LayoutDashboard, History, Plus, LogOut, Settings, KeyRound } from 'lucide-react'
import Logo from './svgs/Logo'
import Button from './ui/Button'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/cn'
import GithubMark from './svgs/GithubMark'


const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'History', icon: History },
  { to: '/wallet', label: 'Keys', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

const MOBILE_BOTTOM_NAV: {
  to: string
  label: string
  icon: typeof LayoutDashboard
  accent?: boolean
}[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'History', icon: History },
  { to: '/tasks/new', label: 'New task', icon: Plus, accent: true },
  { to: '/wallet', label: 'Keys', icon: KeyRound },
] as const

function NavLink({
  to,
  label,
  icon: Icon,
  active,
  compact = false,
}: {
  to: string
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  compact?: boolean
}) {
  if (compact) {
    return (
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center justify-center w-9 h-9 rounded-md transition-colors duration-micro',
          active
            ? 'text-primary bg-primary/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        )}
      >
        <Icon className="w-5 h-5" strokeWidth={1.75} />
      </Link>
    )
  }

  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md transition-colors duration-micro',
        active
          ? 'text-foreground bg-muted'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      )}
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} />
      {label}
    </Link>
  )
}

export function UserMenu() {
  const { user, login, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) {
    return (
      <Button variant="primary" size="sm" onClick={() => login()} className="gap-2">
        <GithubMark className="w-4 h-4" />
        Sign in
      </Button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-2 rounded-md border border-border bg-card pl-1 pr-2.5 py-1 hover:bg-muted transition-colors duration-micro focus-ring"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <img src={user.avatarUrl} alt={user.login} className="w-6 h-6 rounded-md" />
        <span className="text-sm font-medium text-foreground max-w-[88px] truncate hidden sm:inline">
          {user.login}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 w-52 bg-card border border-border rounded-lg p-1 z-overlay shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          >
            <div className="px-2.5 py-2 border-b border-border mb-0.5">
              <p className="text-sm font-medium text-foreground truncate">{user.name ?? user.login}</p>
              <p className="text-xs text-muted-foreground truncate">@{user.login}</p>
            </div>
            <div className="md:hidden py-0.5 border-b border-border mb-0.5">
              {NAV.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              ))}
              <Link
                to="/tasks/new"
                className="flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setOpen(false)}
              >
                <Plus className="w-3.5 h-3.5" />
                New task
              </Link>
            </div>
            <button
              onClick={() => void logout()}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-danger hover:bg-red-50 transition-colors duration-micro"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MobileBottomNav() {
  const { pathname } = useLocation()

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-nav border-t border-border bg-card"
      aria-label="Mobile navigation"
    >
      <div className="grid grid-cols-4 h-14 max-w-lg mx-auto">
        {MOBILE_BOTTOM_NAV.map(({ to, label, icon: Icon, accent }) => {
          const active =
            to === '/'
              ? pathname === '/'
              : pathname === to || pathname.startsWith(`${to}/`)
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                active
                  ? accent
                    ? 'text-primary'
                    : 'text-primary'
                  : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-lg',
                  accent && 'bg-primary text-primary-foreground',
                  active && !accent && 'bg-primary/10',
                )}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={accent ? 2 : 1.75} />
              </span>
              <span className="leading-none">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export { MobileBottomNav }

export function TopNav() {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-nav bg-card border-b border-border">
      <div className="max-w-6xl mx-auto px-gutter h-14 flex items-center gap-2">
        <Logo height={32} className="shrink-0" />

        {/* Desktop — centered links */}
        <nav className="hidden md:flex flex-1 items-center justify-center gap-1" aria-label="Main">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              label={label}
              icon={icon}
              active={pathname.startsWith(to)}
            />
          ))}
        </nav>

        <div className="flex-1 md:hidden" />

        {/* Mobile — only what the bottom bar doesn't already have */}
        <nav className="flex md:hidden items-center gap-0.5" aria-label="Main">
          {NAV.filter((n) => !MOBILE_BOTTOM_NAV.some((b) => b.to === n.to)).map(({ to, label, icon }) => (
            <NavLink key={to} to={to} label={label} icon={icon} active={pathname.startsWith(to)} compact />
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <Link to="/tasks/new" className="hidden md:block">
            <Button size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              New Task
            </Button>
          </Link>
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

export default function AppShell({
  children,
  maxWidth = 'max-w-6xl',
}: {
  children: ReactNode
  maxWidth?: string
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className={cn('mx-auto px-gutter pt-4 pb-24 md:pt-8 md:pb-16', maxWidth)}>{children}</main>
      <MobileBottomNav />
    </div>
  )
}
