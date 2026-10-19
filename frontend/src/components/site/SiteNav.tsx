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

  // Over a black band (.band-dark) the bar turns dark too, so it never sits as a grey strip on black.
  const [overDark, setOverDark] = useState(false)
  useEffect(() => {
    const check = () => {
      const y = 26 // the middle of the 52 px bar
      const bands = [...document.querySelectorAll<HTMLElement>('.band-dark')].filter((el) => !el.closest('header'))
      setOverDark(bands.some((el) => {
        const r = el.getBoundingClientRect()
        return r.top <= y && r.bottom >= y
      }))
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [pathname])

  // Hover opens the menu; a click right after that hover must not close it again (it did: the menu
  // flashed shut for mouse users), so a click only toggles when the menu wasn't just opened by hover.
  const hoverOpenedAt = useRef(0)
  const open = () => {
    window.clearTimeout(closeTimer.current)
    setMenu((was) => {
      if (!was) hoverOpenedAt.current = Date.now()
      return true
    })
  }
  const toggle = () => {
    if (Date.now() - hoverOpenedAt.current < 600) return setMenu(true)
    setMenu((v) => !v)
  }
  const close = () => {
    closeTimer.current = window.setTimeout(() => setMenu(false), 120)
  }

  const linkCls = (active: boolean) =>
    cn(
      'px-3 py-1.5 rounded-pill text-sm transition-colors whitespace-nowrap',
      active ? 'text-foreground bg-foreground/[.06]' : 'text-foreground/80 hover:text-foreground hover:bg-foreground/[.05]',
    )

  const cta = user ? (
    <Button variant="primary" shape="pill" size="sm" onClick={() => navigate('/dashboard')} className="px-4 whitespace-nowrap">
      Dashboard
    </Button>
  ) : (
    <>
      <Button variant="outline" shape="pill" size="sm" data-track="login" data-track-where="nav" onClick={() => login('/dashboard')} className="px-4 whitespace-nowrap">
        Login
      </Button>
      <Button variant="primary" shape="pill" size="sm" data-track="start_free" data-track-where="nav" onClick={() => login('/wallet')} className="px-4 whitespace-nowrap">
        Start free
      </Button>
    </>
  )

  return (
    <>
      <header className={cn('sticky top-0 z-nav backdrop-blur-md border-b border-hairline transition-colors duration-300', overDark ? 'band-dark' : 'bg-background/[.92]')} onMouseLeave={close}>
        <div className="mx-auto max-w-frame h-[52px] px-gutter md:px-12 flex items-center gap-2">
          <Logo height={28} className="shrink-0 mr-4" />

          <nav className="hidden md:flex items-center gap-0.5 flex-1" aria-label="Site">
            <button
              type="button"
              onMouseEnter={open}
              onClick={toggle}
              aria-expanded={menu}
              className={cn(linkCls(menu), 'inline-flex items-center gap-1')}
            >
              Product
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', menu && 'rotate-180')} />
            </button>
            <Link to="/pricing" className={linkCls(pathname === '/pricing')} onMouseEnter={close}>
              Pricing
            </Link>
            <Link to={DEMO_REPLAY_URL} className={linkCls(pathname.startsWith('/r/'))} onMouseEnter={close}>
              Replay
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={cn(linkCls(false), 'hidden lg:inline-flex')} onMouseEnter={close}>
              GitHub
            </a>
          </nav>

          <div className="hidden md:flex items-center gap-2 ml-auto">
            {cta}
            {user && <UserMenu />}
          </div>

          <button
            type="button"
            className="md:hidden ml-auto p-2 -mr-2 rounded-md focus-ring"
            aria-label={sheet ? 'Close menu' : 'Open menu'}
            onClick={() => setSheet((v) => !v)}
          >
            {sheet ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Desktop mega-menu (absolute inside the header; the dimmer and mobile sheet live outside it,
          because the header's backdrop-filter would trap position: fixed children) */}
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
      </header>
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn('hidden md:block fixed inset-0 top-[52px] z-[45] backdrop-blur-[6px]', overDark ? 'bg-black/40' : 'bg-white/40')}
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
            className="md:hidden fixed inset-x-0 top-[52px] bottom-0 z-nav bg-background overflow-y-auto"
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
    </>
  )
}
