import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CircleDot, GitBranch, Box, GitPullRequest } from 'lucide-react'
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
import { createTask } from '../api/client'
import { fadeUp, stagger } from '../lib/motion'
import CapacityMeter from '../components/wallet/CapacityMeter'

const STEPS = [
  { icon: GitBranch, label: 'You approve the plan' },
  { icon: Box, label: 'Runs in a sandbox' },
  { icon: GitPullRequest, label: 'You review, then PR' },
]

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

export default function NewTask() {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [approvePlan, setApprovePlan] = useState(true)
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
      const { taskId } = await createTask(url.trim(), { autoApprove: !approvePlan })
      navigate(`/tasks/${taskId}`)
    } catch (err) {
      const msg = (err as Error).message
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

                <CapacityMeter />

                <Button
                  type="submit"
                  size="lg"
                  className="w-full rounded-lg justify-center"
                  disabled={!url}
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
