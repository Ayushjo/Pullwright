import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CircleDot } from 'lucide-react'
import { createTask } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Button, useToast } from '../components/ui'
import { HandUnderline } from '../components/hand/Scribbles'
import { fadeUp, stagger } from '../lib/motion'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame } from '../components/site/Layout'
import { MonoLabel, TwoToneHeading } from '../components/site/Typography'
import ProductShot from '../components/site/ProductShot'
import { HeroMock } from '../components/site/home/Mocks'
import { BuiltOn, ClosingCta, Demo, Features, Keys, Safety, Shipped, Steps } from '../components/site/home/Sections'
import { DEMO_REPLAY_URL } from '../content/site'
import { SITE_URL, softwareJsonLd, useSeo } from '../lib/seo'

export default function Home() {
  useSeo({
    title: 'Pullwright — GitHub issue in, reviewed pull request out',
    description: 'Hand Pullwright a GitHub issue. It plans the change, edits and runs your tests in a sandbox, gets an independent review, and opens the pull request when you approve. Free to start — no key, no card.',
    path: '/',
    jsonLd: [
      softwareJsonLd,
      { '@type': 'Organization', name: 'Pullwright', url: SITE_URL, logo: `${SITE_URL}/pullwright.png` },
      { '@type': 'WebSite', name: 'Pullwright', url: SITE_URL },
    ],
  })
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { hash } = useLocation()
  const { user, login } = useAuth()
  const { push: pushToast } = useToast()

  // Product-menu links like /#plan: scroll once the section exists (the router doesn't do it).
  useEffect(() => {
    if (!hash) return
    const t = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    return () => window.clearTimeout(t)
  }, [hash])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    if (!user) {
      // Keep what they typed across the GitHub sign-in round trip.
      login(`/tasks/new?url=${encodeURIComponent(trimmed)}`)
      return
    }
    setLoading(true)
    try {
      const { taskId } = await createTask(trimmed)
      navigate(`/tasks/${taskId}`)
    } catch (err) {
      pushToast((err as Error).message, 'error')
      setLoading(false)
    }
  }

  const start = () => (user ? navigate('/tasks/new') : login('/wallet'))

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        {/* Hero */}
        <section className="overflow-hidden">
          <div className="px-gutter md:px-12 pt-14 md:pt-24 pb-12">
            <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="max-w-3xl">
              <motion.div variants={fadeUp}>
                <MonoLabel dot>Autonomous PR agent</MonoLabel>
              </motion.div>
              <motion.div variants={fadeUp} className="mt-5">
                <TwoToneHeading as="h1" size="display" muted="Issue in." strong="Reviewed pull request out." />
              </motion.div>
              <motion.p variants={fadeUp} className="mt-5 text-lead text-muted-foreground max-w-xl">
                Pullwright plans, codes in a sandbox, runs your tests and gets an independent review — then opens the PR when you say so.
              </motion.p>

              <motion.form variants={fadeUp} onSubmit={handleSubmit} className="mt-8 max-w-xl">
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className="w-full sm:w-auto sm:flex-1 min-w-0 flex items-center gap-2 rounded-pill border border-black/15 bg-card pl-4 pr-1.5 h-12 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition">
                    <CircleDot className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="github.com/owner/repo/issues/42"
                      disabled={loading}
                      aria-label="GitHub issue URL"
                      className="flex-1 min-w-0 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80"
                    />
                    <Button type="submit" variant="primary" shape="pill" loading={loading} className="hidden sm:inline-flex h-9 px-4">
                      {user ? 'Start' : 'Sign in'}
                      {!loading && <ArrowRight className="w-4 h-4" />}
                    </Button>
                  </label>
                  <Button type="submit" variant="primary" shape="pill" size="lg" loading={loading} className="sm:hidden h-12">
                    {user ? 'Start' : 'Sign in'}
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </Button>
                  <Link to={DEMO_REPLAY_URL} className="sm:w-auto">
                    <Button variant="outline" shape="pill" size="lg" className="h-12 w-full" tabIndex={-1}>
                      Watch a replay
                    </Button>
                  </Link>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  <span className="relative inline-block text-foreground">
                    Free to run
                    <HandUnderline className="text-primary/70" strokeWidth={3} delay={0.9} />
                  </span>{' '}
                  with a free Google Gemini key — no card.{' '}
                  {!user && 'GitHub sign-in required. '}
                  <Link to="/pricing" className="text-primary hover:underline underline-offset-2">
                    Three ways to use it
                  </Link>
                </p>
              </motion.form>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="px-gutter md:px-12 pb-14 md:pb-20">
            <ProductShot backdrop="sky" bleed inner="sm:p-10 lg:p-14">
              <HeroMock />
            </ProductShot>
          </motion.div>
        </section>

        <BuiltOn />
        <Features />
        <Steps />
        <Demo />
        <Keys />
        <Shipped />
        <Safety />
        <ClosingCta onStart={start} />
        <SiteFooter />
      </Frame>
    </div>
  )
}

