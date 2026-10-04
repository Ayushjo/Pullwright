import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CircleDot, GitBranch, Box, GitPullRequest, ShieldAlert } from 'lucide-react'
import AppShell from '../components/AppShell'
import {
  Badge,
  BentoCard,
  BentoContent,
  Button,
  Input,
  Separator,
  useToast,
} from '../components/ui'
import { ApiError, createTask } from '../api/client'
import { fadeUp, stagger } from '../lib/motion'
import CapacityMeter from '../components/wallet/CapacityMeter'
import GithubMark from '../components/svgs/GithubMark'

const STEPS = [
  { icon: GitBranch, label: 'You approve the plan' },
  { icon: Box, label: 'Runs in a sandbox' },
  { icon: GitPullRequest, label: 'You review, then PR' },
]


export default function NewTask() {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [approvePlan, setApprovePlan] = useState(true)
  // Private repo + keys that may train on prompts: asked once, per task (server answers 409 private_repo_training).
  const [consent, setConsent] = useState<{ message: string } | null>(null)
  const [allowTraining, setAllowTraining] = useState(false)
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
      const { taskId } = await createTask(url.trim(), { autoApprove: !approvePlan, ...(allowTraining ? { allowTraining: true } : {}) })
      navigate(`/tasks/${taskId}`)
    } catch (err) {
      const msg = (err as Error).message
      if (err instanceof ApiError && err.code === 'private_repo_training') {
        setConsent({ message: msg })
        setLoading(false)
        return
      }
      pushToast(msg, 'error')
      setError(msg)
      setLoading(false)
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
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <GithubMark className="w-5 h-5 text-primary" />
                  </div>
                  <Badge tone="primary" dot>New task</Badge>
                </div>
                <h1 className="text-xl font-bold text-foreground">Submit a GitHub issue</h1>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  Paste the issue URL — Pullwright takes it from there.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
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
                      {/key|wallet/i.test(error) ? (
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

                <Button
                  type="submit"
                  size="lg"
                  className="w-full rounded-lg justify-center"
                  disabled={!url || (consent !== null && !allowTraining)}
                  loading={loading}
                >
                  {loading ? 'Starting…' : 'Start agent'}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </Button>
              </form>

              <Separator className="my-6" />

              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                  What happens next
                </p>
                <div className="grid gap-3 sm:grid-cols-3 sm:items-stretch">
                  {STEPS.map(({ icon: Icon, label }, i) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 rounded-lg border border-border bg-muted p-3.5 h-full min-h-[72px]"
                    >
                      <span className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-primary" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-mono text-muted-foreground leading-none mb-1">0{i + 1}</p>
                        <p className="text-xs font-medium text-foreground leading-snug">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
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
