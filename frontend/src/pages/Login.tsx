import { useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Check, Lock, LogOut, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button, useToast } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import GithubMark from '../components/svgs/GithubMark'
import SiteNav from '../components/site/SiteNav'
import { Frame } from '../components/site/Layout'
import { MonoLabel } from '../components/site/Typography'
import ProductShot from '../components/site/ProductShot'
import { HeroMock } from '../components/site/home/Mocks'
import { HandUnderline } from '../components/hand/Scribbles'
import { useSeo } from '../lib/seo'

const ASKS = [
  { icon: GithubMark, text: 'Read the issues you send it and open PRs on repos you choose' },
  { icon: Lock, text: 'Your token is encrypted at rest and never enters the sandbox' },
  { icon: LogOut, text: 'Sign out any time from the account menu' },
]

/** Sign in and sign up are the same step: the first GitHub sign-in creates the account. */
export default function Login() {
  useSeo({ title: 'Sign in or sign up', description: 'Connect GitHub to run Pullwright on your repos. Signing in creates your account — it’s free, with 10 Claude tasks a month and no key needed.', path: '/login' })
  const { user, loading, login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { push: pushToast } = useToast()

  // Where to go after signing in: router state (RouteGuard) or ?returnTo= (links from Pricing, Wallet, …).
  const params = new URLSearchParams(location.search)
  const stateFrom = (location.state as { from?: string } | null)?.from
  const queryFrom = params.get('returnTo')
  const raw = stateFrom ?? (queryFrom && queryFrom.startsWith('/') && !queryFrom.startsWith('//') ? queryFrom : null) ?? '/dashboard'
  const target = raw === '/login' || raw === '/' ? '/dashboard' : raw

  useEffect(() => {
    if (!loading && user) navigate(target, { replace: true })
  }, [user, loading, target, navigate])

  useEffect(() => {
    const err = new URLSearchParams(location.search).get('error')
    if (err) pushToast(err === 'access_denied' ? 'GitHub access was denied. Please try again.' : `Sign-in error: ${err}`, 'error')
  }, [location.search, pushToast])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteNav />
      <Frame>
        <section className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:min-h-[calc(100dvh-52px)]">
          {/* Sign in */}
          <div className="flex items-center px-gutter md:px-12 py-14 md:py-20 lg:border-r border-hairline">
            <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="w-full max-w-md mx-auto lg:mx-0">
              <motion.div variants={fadeUp}>
                <MonoLabel dot>Sign in or sign up</MonoLabel>
              </motion.div>
              <motion.div variants={fadeUp} className="mt-5">
                <h1 className="font-serif text-[48px] sm:text-[60px] font-normal leading-[0.98] tracking-[-0.02em] text-foreground">
                  Welcome to <em className="text-primary">Pullwright.</em>
                </h1>
              </motion.div>
              <motion.p variants={fadeUp} className="mt-4 text-[15px] sm:text-base text-muted-foreground leading-relaxed">
                Connect GitHub to run it on your repos. New here? Signing in creates your account —{' '}
                <span className="relative inline-block text-foreground">
                  it’s free
                  <HandUnderline className="text-primary/70" strokeWidth={3} delay={0.7} />
                </span>
                .
              </motion.p>

              <motion.div variants={fadeUp} className="mt-8">
                <Button variant="primary" shape="pill" size="lg" className="w-full h-12 text-[15px] gap-2.5" data-track="github_signin" data-track-where="login" onClick={() => login(target)} disabled={loading} loading={loading}>
                  <GithubMark className="w-5 h-5" />
                  Continue with GitHub
                </Button>
              </motion.div>

              <motion.div variants={fadeUp} className="mt-9 border-t border-hairline pt-5">
                <MonoLabel>What we ask GitHub for</MonoLabel>
                <ul className="mt-3 divide-y divide-hairline">
                  {ASKS.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-start gap-3 py-3 text-sm text-foreground/80 leading-snug">
                      <Icon className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                      {text}
                    </li>
                  ))}
                </ul>
              </motion.div>

              <motion.p variants={fadeUp} className="mt-6 text-sm text-muted-foreground">
                Just looking?{' '}
                <Link to="/pricing" className="text-primary hover:underline underline-offset-2">
                  See pricing
                </Link>{' '}
                or{' '}
                <Link to="/" className="text-primary hover:underline underline-offset-2">
                  how it works
                </Link>
                .
              </motion.p>
            </motion.div>
          </div>

          {/* What you get */}
          <div className="band-dark flex flex-col justify-center px-gutter md:px-12 py-14 md:py-20 overflow-hidden">
            <h2 className="font-serif text-[40px] sm:text-[52px] font-normal leading-[1] tracking-[-0.02em] text-foreground">
              Issue in. <em className="text-primary">Reviewed PR out.</em>
            </h2>
            <ul className="mt-6 grid sm:grid-cols-3 gap-x-6 gap-y-3">
              {[
                [ShieldCheck, 'Plan you approve'],
                [Check, 'Tests in a sandbox'],
                [Check, 'PR on your click'],
              ].map(([Icon, label]) => {
                const I = Icon as typeof Check
                return (
                  <li key={label as string} className="flex items-center gap-2 text-sm text-foreground/80">
                    <I className="w-4 h-4 text-primary shrink-0" />
                    {label as string}
                  </li>
                )
              })}
            </ul>
            <ProductShot backdrop="sky" bleed className="mt-10" inner="sm:p-8">
              <HeroMock floatingPr={false} />
            </ProductShot>
          </div>
        </section>
      </Frame>
    </div>
  )
}
