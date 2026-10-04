import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react'
import Logo from '../svgs/Logo'
import { Button } from '../ui'
import { UserMenu } from '../AppShell'
import { useAuth } from '../../context/AuthContext'
import { cn } from '../../lib/cn'
import { DEMO_REPLAY_URL, PRODUCT_MENU, REPO_URL } from '../../content/site'

function MenuLink({ label, to, external, onClick, className }: { label: string; to: string; external?: boolean; onClick?: () => void; className?: string }) {
  const cls = cn('inline-flex items-center gap-1 text-foreground hover:text-primary transition-colors', className)
  return external ? (
    <a href={to} target="_blank" rel="noreferrer" className={cls} onClick={onClick}>
      {label}
      <ArrowUpRight className="w-3.5 h-3.5" />
    </a>
  ) : (
    <Link to={to} className={cls} onClick={onClick}>
      {label}
    </Link>
  )
}

/** Marketing header (Home, Pricing, Replay, Login): 52 px, blurred, hairline, Product mega-menu. */
export default function SiteNav() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  const [menu, setMenu] = useState(false)
  const [sheet, setSheet] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)

  // Close menus whenever the route changes.
  const [lastRoute, setLastRoute] = useState(pathname + hash)
  if (lastRoute !== pathname + hash) {
    setLastRoute(pathname + hash)
    setMenu(false)
    setSheet(false)
  }
  useEffect(() => {
    document.body.style.overflow = sheet ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [sheet])

  const open = () => {
    window.clearTimeout(closeTimer.current)
    setMenu(true)
  }
  const close = () => {
    closeTimer.current = window.setTimeout(() => setMenu(false), 120)
  }

  const linkCls = (active: boolean) =>
    cn('px-3 py-1.5 rounded-pill text-sm transition-colors', active ? 'text-foreground bg-black/[.05]' : 'text-foreground/80 hover:text-foreground hover:bg-black/[.04]')

  const cta = user ? (
    <Button variant="solid" shape="pill" size="sm" onClick={() => navigate('/dashboard')} className="px-4">
      Dashboard
    </Button>
  ) : (
    <>
      <Button variant="outline" shape="pill" size="sm" onClick={() => login('/dashboard')} className="px-4">
        Login
      </Button>
      <Button variant="solid" shape="pill" size="sm" onClick={() => login('/wallet')} className="px-4">
        Start free
      </Button>
    </>
  )

  return (
    <header className="sticky top-0 z-nav bg-background/80 backdrop-blur-md border-b border-hairline" onMouseLeave={close}>
      <div className="mx-auto max-w-frame h-[52px] px-gutter md:px-12 flex items-center gap-2">
        <Logo height={28} className="shrink-0 mr-4" />

        <nav className="hidden md:flex items-center gap-0.5 flex-1" aria-label="Site">
          <button type="button" onMouseEnter={open} onClick={() => setMenu((v) => !v)} aria-expanded={menu} className={cn(linkCls(menu), 'inline-flex items-center gap-1')}>
            Product
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', menu && 'rotate-180')} />
          </button>
          <Link to="/pricing" className={linkCls(pathname === '/pricing')} onMouseEnter={close}>
            Pricing
          </Link>
          <Link to={DEMO_REPLAY_URL} className={linkCls(pathname.startsWith('/r/'))} onMouseEnter={close}>
            Replay
          </Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={linkCls(false)} onMouseEnter={close}>
            GitHub
          </a>
        </nav>

        <div className="hidden md:flex items-center gap-2 ml-auto">
          {cta}
          {user && <UserMenu />}
        </div>

        <button type="button" className="md:hidden ml-auto p-2 -mr-2 rounded-md focus-ring" aria-label={sheet ? 'Close menu' : 'Open menu'} onClick={() => setSheet((v) => !v)}>
          {sheet ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Desktop mega-menu */}
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            onMouseEnter={open}
            className="hidden md:block absolute inset-x-0 top-full bg-background border-b border-hairline shadow-[0_24px_40px_-24px_rgba(0,0,0,0.18)]"
          >
            <div className="mx-auto max-w-frame px-12 py-8 grid grid-cols-4 gap-8">
              {PRODUCT_MENU.map((g) => (
                <div key={g.group}>
                  <p className="text-[13px] text-muted-foreground mb-3">{g.group}</p>
                  <ul className="space-y-2">
                    {g.items.map((it) => (
                      <li key={it.label}>
                        <MenuLink {...it} className="text-[15px]" onClick={() => setMenu(false)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="hidden md:block fixed inset-0 top-[52px] -z-10 bg-white/40 backdrop-blur-[6px]"
            onMouseEnter={close}
            aria-hidden
          />
        )}
      </AnimatePresence>

      {/* Mobile sheet */}
      <AnimatePresence>
        {sheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="md:hidden fixed inset-x-0 top-[52px] bottom-0 bg-background overflow-y-auto"
          >
            <div className="px-gutter py-6 space-y-7">
              {PRODUCT_MENU.map((g) => (
                <div key={g.group}>
                  <p className="text-[13px] text-muted-foreground mb-2">{g.group}</p>
                  <ul className="space-y-1.5">
                    {g.items.map((it) => (
                      <li key={it.label}>
                        <MenuLink {...it} className="text-lg" onClick={() => setSheet(false)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="flex gap-2 pt-2">{cta}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
