import { useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Link2, Box, GitPullRequest } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button, Separator, useToast } from '../components/ui'
import Logo, { LogoIcon } from '../components/svgs/Logo'
import { fadeUp, stagger } from '../lib/motion'
import GithubMark from '../components/svgs/GithubMark'


const CAPABILITIES = [
  { icon: Link2, title: 'Paste an issue URL', desc: 'Any public or private repo you have access to.' },
  { icon: Box, title: 'Agent runs in Docker', desc: 'Code changes happen in isolation — not on your machine.' },
  { icon: GitPullRequest, title: 'You get a real PR', desc: 'Review the diff, request changes, merge when ready.' },
] as const

function BrandAside() {
  return (
    <aside className="hidden lg:flex lg:flex-1 min-w-0 bg-black text-white relative overflow-hidden">
      <div className="absolute -bottom-16 -right-16 opacity-[0.04] pointer-events-none select-none">
        <LogoIcon size={280} />
      </div>
      <div className="relative z-10 flex flex-col min-h-screen w-full max-w-2xl mx-auto px-12 xl:px-16 py-12">
        <Link to="/" className="shrink-0 w-fit">
          <Logo height={32} variant="inverse" linked={false} />
        </Link>
        <div className="flex-1 flex flex-col justify-center py-16">
          <motion.div variants={stagger(0.07)} initial="hidden" animate="show" className="max-w-md">
            <motion.h1 variants={fadeUp} className="text-[2.35rem] xl:text-[2.65rem] font-bold leading-[1.12] tracking-tight text-white">
              GitHub issues → pull requests.
            </motion.h1>
            <motion.p variants={fadeUp} className="text-white/45 text-base leading-relaxed mt-5">
              Pullwright reads an issue, plans the work, executes in a sandbox, and opens a pull request on your repo.
            </motion.p>
            <motion.ul variants={fadeUp} className="mt-10 space-y-6">
              {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
                <li key={title} className="flex gap-4">
                  <div className="w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-white/50" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white/85">{title}</p>
                    <p className="text-sm text-white/35 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </motion.ul>
            <motion.p variants={fadeUp} className="mt-10 font-mono text-xs text-white/20 tracking-wide">
              github.com/owner/repo/issues/42
            </motion.p>
          </motion.div>
        </div>
        <p className="text-white/20 text-xs shrink-0">Open source · MIT</p>
      </div>
    </aside>
  )
}

function SignInForm({ loading, onLogin }: { loading: boolean; onLogin: () => void }) {
  return (
    <>
      <Button
        variant="primary"
        size="lg"
        className="w-full justify-center gap-2.5"
        onClick={onLogin}
        disabled={loading}
        loading={loading}
      >
        <GithubMark className="w-5 h-5" />
        Continue with GitHub
      </Button>
      <div className="flex items-center gap-3 my-5">
        <Separator className="flex-1" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">OAuth 2.0</span>
        <Separator className="flex-1" />
      </div>
      <ul className="space-y-2 text-xs text-muted-foreground leading-relaxed">
        <li>Read/write access to repos you choose.</li>
        <li>Token encrypted at rest — never logged.</li>
        <li>Sign out anytime from the nav menu.</li>
      </ul>
      <p className="text-left text-muted-foreground text-xs mt-5">
        <Link to="/" className="text-primary hover:underline inline-flex items-center gap-1">
          Back to homepage <ArrowRight className="w-3 h-3" />
        </Link>
      </p>
    </>
  )
}

function CapabilitiesList({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        What you get
      </p>
      <ul className="space-y-3">
        {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
          <li key={title} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Icon className="w-3.5 h-3.5 text-primary" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium text-foreground leading-snug">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Login() {
  const { user, loading, login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { push: pushToast } = useToast()

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  useEffect(() => {
    if (!loading && user) {
      navigate(from === '/login' ? '/dashboard' : from, { replace: true })
    }
  }, [user, loading, from, navigate])

  useEffect(() => {
    const err = new URLSearchParams(location.search).get('error')
    if (err) {
      pushToast(
        err === 'access_denied' ? 'GitHub access was denied. Please try again.' : `Sign-in error: ${err}`,
        'error',
      )
    }
  }, [location.search, pushToast])

  const handleLogin = () => login(from === '/login' ? '/dashboard' : from)

  return (
    <div className="min-h-dvh bg-background flex flex-col lg:flex-row">
      <BrandAside />

      <main className="w-full lg:w-[min(460px,42vw)] xl:w-[480px] shrink-0 bg-card lg:border-l border-border lg:flex lg:flex-col lg:min-h-dvh">
        {/* ── Mobile: single tight scroll column (no flex-1 gap) ── */}
        <div className="lg:hidden">
          <div className="px-gutter pt-6 pb-4 border-b border-border bg-background">
            <Link to="/" className="inline-block">
              <Logo height={28} linked={false} />
            </Link>
            <h1 className="text-[1.5rem] font-bold text-foreground tracking-tight leading-tight mt-4">
              GitHub issues → pull requests.
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Sign in to run the agent on your repos.
            </p>
          </div>

          <div className="px-gutter py-5">
            <h2 className="text-base font-semibold text-foreground">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Connect your GitHub account to continue.
            </p>
            <SignInForm loading={loading} onLogin={handleLogin} />
          </div>

          <div className="px-gutter pb-8 pt-4 border-t border-border" style={{ backgroundColor: '#f2f2f2' }}>
            <CapabilitiesList />
          </div>
        </div>

        {/* ── Desktop: centered sign-in panel ── */}
        <div className="hidden lg:flex flex-1 flex-col justify-center px-10 py-12">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full max-w-sm mx-auto"
          >
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-foreground">Sign in</h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                Connect your GitHub account to continue.
              </p>
            </div>
            <SignInForm loading={loading} onLogin={handleLogin} />
          </motion.div>
        </div>
      </main>
    </div>
  )
}
