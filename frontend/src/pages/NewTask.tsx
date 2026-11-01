import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CircleDot, GitBranch, Box, GitPullRequest, Gift, ShieldAlert } from 'lucide-react'
import AppShell from '../components/AppShell'
import { BentoCard, BentoContent, Button, Input, useToast } from '../components/ui'
import { ApiError, claimTrial, createTask, getBilling, getCredits, type BillingInfo } from '../api/client'
import { fadeUp, stagger } from '../lib/motion'
import CapacityMeter from '../components/wallet/CapacityMeter'
import FreeClaudeMeter from '../components/billing/FreeClaudeMeter'
import { useSeo } from '../lib/seo'

const STEPS = [
  { icon: GitBranch, label: 'You approve the plan' },
  { icon: Box, label: 'Runs in a sandbox' },
  { icon: GitPullRequest, label: 'You review, then PR' },
]


export default function NewTask() {
  useSeo({ title: 'New task', description: 'Pullwright — your tasks, keys and plan.', noindex: true })
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') ?? '')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [approvePlan, setApprovePlan] = useState(true)
  // The hero's chips carry through sign-in as ?ask=0 / ?review=0.
  const [askFirst, setAskFirst] = useState(() => new URLSearchParams(window.location.search).get('ask') !== '0')
  const [review, setReview] = useState(() => new URLSearchParams(window.location.search).get('review') !== '0')
  // Private repo + keys that may train on prompts: asked once, per task (server answers 409 private_repo_training).
  const [consent, setConsent] = useState<{ message: string } | null>(null)
  const [allowTraining, setAllowTraining] = useState(false)
  // No key and no credit (402): offer the one-time free trial when this GitHub account still has it.
  const [trialOffer, setTrialOffer] = useState<number | null>(null)
  const [claiming, setClaiming] = useState(false)
  // Which money a new task uses: shows the free Claude allowance when that's what will run it.
  const [ent, setEnt] = useState<BillingInfo['entitlement'] | null>(null)
  useEffect(() => {
    getBilling()
      .then((b) => setEnt(b.entitlement))
      .catch(() => setEnt(null))
  }, [])
  const onFree = ent?.key?.kind === 'platform' && ent.key.fundedBy === 'free_claude'
  const navigate = useNavigate()
  const { push: pushToast } = useToast()

  const isValidUrl = /github\.com\/.+\/.+\/issues\/\d+/.test(url)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidUrl) {
      setError('Enter a valid GitHub issue URL — e.g. https://github.com/owner/repo/issues/42')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { taskId } = await createTask(url.trim(), { autoApprove: !approvePlan, ...(askFirst ? {} : { askFirst: false }), ...(review ? {} : { review: false }), ...(allowTraining ? { allowTraining: true } : {}) })
      navigate(`/tasks/${taskId}`)
    } catch (err) {
      const msg = (err as Error).message
      if (err instanceof ApiError && err.code === 'private_repo_training') {
        setConsent({ message: msg })
        setLoading(false)
        return
      }
      if (err instanceof ApiError && err.code === 'needs_key_or_plan') {
        const c = await getCredits().catch(() => null)
        setTrialOffer(c?.trial.available ? c.trial.usd : null)
      }
      setErrorCode(err instanceof ApiError ? (err.code ?? null) : null)
      pushToast(msg, 'error')
      setError(msg)
      setLoading(false)
    }
  }

  async function startTrial() {
    setClaiming(true)
    try {
      await claimTrial()
      setTrialOffer(null)
      setError('')
      pushToast('Free trial added — starting your task.', 'success')
      const { taskId } = await createTask(url.trim(), { autoApprove: !approvePlan, ...(askFirst ? {} : { askFirst: false }), ...(review ? {} : { review: false }), ...(allowTraining ? { allowTraining: true } : {}) })
      navigate(`/tasks/${taskId}`)
    } catch (err) {
      setTrialOffer(null)
      setError((err as Error).message)
    } finally {
      setClaiming(false)
    }
  }

  return (
    <AppShell maxWidth="max-w-lg">
      <motion.div variants={stagger(0.06)} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Dashboard
          </Link>
        </motion.div>

        <motion.div variants={fadeUp}>
          <BentoCard interactive={false}>
            <BentoContent className="p-6 sm:p-7">
              <div className="mb-7">
                <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <span aria-hidden className="w-1.5 h-1.5 bg-primary" />
                  New task
                </span>
                <h1 className="mt-3 font-serif text-[38px] sm:text-[44px] font-normal leading-[1.02] tracking-[-0.015em] text-foreground">Hand it an <em className="text-primary">issue.</em></h1>
                <p className="text-[15px] text-muted-foreground mt-1.5 leading-relaxed">Paste the issue URL — Pullwright takes it from there.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block font-mono text-[11px] text-muted-foreground mb-2 uppercase tracking-[0.08em]">
                    GitHub issue URL
                  </label>
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      setError('')
                      setConsent(null)
                      setAllowTraining(false)
                    }}
                    placeholder="https://github.com/owner/repo/issues/42"
                    autoFocus
                    disabled={loading}
                    invalid={!!error}
                    icon={<CircleDot className="w-4 h-4" />}
                  />
                  {error && (
                    <p className="text-danger text-xs mt-2">
                      {error}{' '}
                      {errorCode === 'active_limit' ? (
                        <Link to="/dashboard" className="text-primary underline">See your running tasks</Link>
                      ) : /key|wallet/i.test(error) ? (
                        <Link to="/wallet" className="text-primary underline">Add a key</Link>
                      ) : /upgrade|limit|runs|tasks/i.test(error) ? (
                        <Link to="/pricing" className="text-primary underline">See plans</Link>
                      ) : null}
                    </p>
                  )}
                </div>

                <label className="flex items-start gap-2.5 text-[13px] text-foreground cursor-pointer select-none">
                  <input type="checkbox" checked={approvePlan} onChange={(e) => setApprovePlan(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
                  <span>
                    Let me approve the plan before it starts
                    <span className="block text-xs text-muted-foreground">Recommended. Nothing is changed and no PR is opened without your review.</span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-[13px] text-foreground cursor-pointer select-none">
                  <input type="checkbox" checked={askFirst} onChange={(e) => setAskFirst(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
                  <span>
                    Ask before guessing
                    <span className="block text-xs text-muted-foreground">If the issue leaves something open, stop and ask you. Off: it decides and says what it assumed.</span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-[13px] text-foreground cursor-pointer select-none">
                  <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
                  <span>
                    Independent review
                    <span className="block text-xs text-muted-foreground">A second model checks the diff against every requirement. Off: your tests and checks only.</span>
                  </span>
                </label>

                {trialOffer !== null && (
                  <div className="border border-hairline bg-card p-3.5">
                    <p className="flex items-start gap-2 text-[13px]">
                      <Gift className="w-4 h-4 shrink-0 mt-0.5 text-primary" strokeWidth={1.75} />
                      <span>
                        Try it first: ${trialOffer.toFixed(2)} of usage on our models, enough for 2 tasks. Once per GitHub account, no card.
                      </span>
                    </p>
                    <Button type="button" size="sm" className="mt-3 rounded-md px-4" loading={claiming} onClick={startTrial}>
                      Use the free trial for this task
                    </Button>
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {consent && (
                    <motion.div
                      key="consent"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5" role="alert">
                        <p className="flex items-start gap-2 text-[13px] text-amber-900">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.75} />
                          {consent.message}
                        </p>
                        <label className="mt-3 flex items-start gap-2.5 text-[13px] text-foreground cursor-pointer select-none">
                          <input type="checkbox" checked={allowTraining} onChange={(e) => setAllowTraining(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
                          <span>Allow it for this task only</span>
                        </label>
                        <Link to="/wallet" className="mt-2 inline-block text-xs font-medium text-primary hover:underline underline-offset-2">
                          Or add a key that doesn't train →
                        </Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <CapacityMeter />
                {(onFree || (ent?.free?.enabled && !ent.key)) && <FreeClaudeMeter free={ent?.free} />}

                <Button
                  type="submit"
                  size="lg"
                  shape="pill"
                  className="w-full h-12 justify-center"
                  disabled={!url || (consent !== null && !allowTraining)}
                  loading={loading}
                >
                  {loading ? 'Starting…' : 'Start agent'}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </Button>
              </form>

              <div className="mt-8 pt-6 border-t border-hairline">
                <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.08em] mb-3">What happens next</p>
                <ol className="grid sm:grid-cols-3 border border-hairline rounded-md overflow-hidden">
                  {STEPS.map(({ icon: Icon, label }, i) => (
                    <li key={label} className="p-3.5 min-w-0 border-hairline [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
                        <Icon className="w-4 h-4 text-foreground/50" strokeWidth={1.75} />
                      </div>
                      <p className="mt-3 text-[13px] text-foreground leading-snug">{label}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </BentoContent>
          </BentoCard>

          <p className="text-center text-muted-foreground text-xs mt-4">
            Runs in an isolated sandbox with no network access. Your GitHub token never enters it.
          </p>
        </motion.div>
      </motion.div>
    </AppShell>
  )
}
