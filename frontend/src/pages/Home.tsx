import { useState, type ElementType } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  CircleDot,
  GitBranch,
  Box,
  GitPullRequest,
  Terminal,
  Play,
  Shield,
  Container,
  Radio,
  Wallet,
} from 'lucide-react'
import { TopNav, MobileBottomNav } from '../components/AppShell'
import Logo from '../components/svgs/Logo'
import { createTask } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  Badge,
  BentoCard,
  BentoContent,
  BentoHeader,
  Button,
  Input,
  SectionHeader,
  Separator,
  useToast,
} from '../components/ui'
import { cn } from '../lib/cn'
import { fadeUp, stagger } from '../lib/motion'


const FLOW = [
  { label: 'Issue', desc: 'Paste the GitHub URL', icon: CircleDot },
  { label: 'Plan', desc: 'Agent maps the repo', icon: GitBranch },
  { label: 'Sandbox', desc: 'Code runs in Docker', icon: Box },
  { label: 'PR', desc: 'Pull request opened', icon: GitPullRequest },
] as const

const PILLARS = [
  { n: '01', title: 'Plan', desc: 'Breaks the issue into verifiable steps.', icon: GitBranch },
  { n: '02', title: 'Execute', desc: 'Edits files and runs commands in isolation.', icon: Box },
  { n: '03', title: 'Ship', desc: 'Commits, pushes, and opens the PR.', icon: GitPullRequest },
] as const

const BENEFITS = [
  { icon: Shield, text: 'GitHub OAuth — your token, your PRs' },
  { icon: Container, text: 'Docker sandbox — no host access' },
  { icon: Wallet, text: 'Per-task LLM budget cap' },
  { icon: Radio, text: 'Live SSE logs while it runs' },
] as const

const LOG_LINES = [
  { t: 'phase', text: 'Planning issue #11…' },
  { t: 'tool', text: 'view_file  frontend/src/pages/TaskView.tsx' },
  { t: 'tool', text: 'write_file  src/components/Timeline.tsx' },
  { t: 'ok', text: 'Step 1 verified' },
  { t: 'tool', text: 'run_command  npm run build' },
  { t: 'ok', text: 'Step 2 verified' },
  { t: 'phase', text: 'Opening pull request…' },
] as const

function LogMock({ lines, limit }: { lines: readonly { t: string; text: string }[]; limit?: number }) {
  const shown = limit ? lines.slice(0, limit) : lines
  return (
    <div className="log-mock p-4 space-y-1.5 min-h-[200px]">
      {shown.map((line, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={cn('shrink-0 select-none', line.t === 'ok' ? 'text-success' : 'text-primary/50')}>›</span>
          <span
            className={cn(
              line.t === 'ok' ? 'text-success font-medium' : 'text-foreground/75',
              line.t === 'phase' && 'text-primary font-medium',
            )}
          >
            {line.text}
          </span>
        </div>
      ))}
    </div>
  )
}

function FlowStep({ label, desc, icon: Icon, step }: { label: string; desc: string; icon: ElementType; step: number }) {
  return (
    <div className="flex items-start gap-3.5">
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center">
          <Icon className="w-[18px] h-[18px] text-foreground" strokeWidth={1.75} />
        </div>
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-elevated border border-border text-[9px] font-mono text-muted-foreground flex items-center justify-center">
          {step}
        </span>
      </div>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{desc}</p>
      </div>
    </div>
  )
}

function TaskViewMock() {
  return (
    <BentoCard className="h-full">
      <BentoHeader action={<span className="text-xs font-mono text-muted-foreground tabular-nums">2:14</span>}>
        <div className="flex items-center gap-2.5 min-w-0">
          <Badge tone="primary" dot>Running</Badge>
          <span className="text-sm font-medium text-foreground truncate">#11 — Activity timeline</span>
        </div>
      </BentoHeader>
      <div className="grid sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border">
        <div className="sm:col-span-2 p-4 space-y-2 bg-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Plan</p>
          {['Implement changes', 'Verify build', 'Commit'].map((s, i) => (
            <div
              key={s}
              className={cn(
                'text-xs px-2.5 py-2 rounded-md border',
                i === 0
                  ? 'bg-primary/10 border-primary/25 text-primary font-medium'
                  : 'border-border text-muted-foreground bg-background',
              )}
            >
              {i === 0 ? '✓ ' : ''}{s}
            </div>
          ))}
        </div>
        <div className="sm:col-span-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-4 pt-4 pb-2">Terminal</p>
          <LogMock lines={LOG_LINES} limit={5} />
        </div>
      </div>
    </BentoCard>
  )
}

function LiveRunCard() {
  return (
    <BentoCard className="h-full flex flex-col">
      <BentoHeader action={<span className="text-[10px] font-mono text-muted-foreground">issue #11</span>}>
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-medium text-foreground">Live run</span>
        </div>
      </BentoHeader>
      <LogMock lines={LOG_LINES} />
    </BentoCard>
  )
}

function BenefitsCard() {
  return (
    <BentoCard className="h-full flex flex-col">
      <BentoHeader>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">What you get</p>
      </BentoHeader>
      <BentoContent className="space-y-4 flex-1 flex flex-col justify-center">
        {BENEFITS.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-primary" strokeWidth={1.75} />
            </div>
            <p className="text-sm text-foreground leading-snug">{text}</p>
          </div>
        ))}
      </BentoContent>
    </BentoCard>
  )
}

function PillarCard({ n, title, desc, icon: Icon }: (typeof PILLARS)[number]) {
  return (
    <BentoCard className="h-full">
      <BentoContent className="h-full flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" strokeWidth={1.75} />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{n}</span>
        </div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-1.5 leading-snug flex-1">{desc}</p>
      </BentoContent>
    </BentoCard>
  )
}

function GitHubFlowStrip() {
  return (
    <BentoCard interactive={false}>
      <BentoHeader action={<span className="text-[10px] font-mono text-muted-foreground">issue #11</span>}>
        <div>
          <p className="text-sm font-semibold text-foreground">What you end up with</p>
          <p className="text-xs text-muted-foreground mt-0.5">Same repo · your account · real branch &amp; PR</p>
        </div>
      </BentoHeader>

      <div className="grid lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <div className="p-5 lg:p-6 border-b lg:border-b-0 lg:border-r border-border flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <CircleDot className="w-3.5 h-3.5 text-success shrink-0" strokeWidth={2} />
            <span className="text-xs font-medium text-success">Open issue</span>
            <span className="text-xs text-muted-foreground ml-auto font-mono">#11</span>
          </div>
          <h3 className="text-base font-semibold text-foreground leading-snug mb-1">
            Activity timeline + TaskView integration
          </h3>
          <p className="text-sm text-muted-foreground mb-5">Ayushjo/MyOwnDevin</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs mt-auto">
            {[
              ['Label', 'enhancement'],
              ['Steps', '3 planned'],
              ['Runtime', '~9 min'],
              ['Input', '…/issues/11'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">{k}</dt>
                <dd className="text-foreground font-medium mt-0.5 truncate">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="hidden lg:flex flex-col items-center justify-center px-5 bg-muted self-stretch">
          <div className="w-10 h-10 rounded-full border border-border bg-card flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-primary" />
          </div>
        </div>

        <div className="p-5 lg:p-6 bg-primary/5 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <GitPullRequest className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2} />
            <span className="text-xs font-medium text-primary">Pull request</span>
            <span className="text-xs text-muted-foreground ml-auto font-mono">open</span>
          </div>
          <h3 className="text-base font-semibold text-foreground leading-snug mb-1">
            fix: Activity timeline integration
          </h3>
          <p className="text-xs font-mono text-muted-foreground mb-5">
            <span className="text-primary">pullwright/task-b0efb2ec</span>
            <span className="text-muted-foreground"> → </span>main
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs mt-auto">
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Files</dt>
              <dd className="text-foreground font-medium mt-0.5">
                <span className="text-success">+12</span>
                <span className="text-muted-foreground mx-0.5">/</span>
                <span className="text-danger">−2</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Cost</dt>
              <dd className="text-foreground font-medium mt-0.5">$0.013</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Steps</dt>
              <dd className="text-foreground font-medium mt-0.5">3 / 3</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[10px] uppercase tracking-wide">Closes</dt>
              <dd className="text-foreground font-medium mt-0.5">#11</dd>
            </div>
          </dl>
        </div>
      </div>
    </BentoCard>
  )
}

function DemoVideo() {
  const [hasVideo] = useState(false)

  return (
    <BentoCard interactive={false} className="overflow-hidden">
      <div className="aspect-video bg-[#0D1117] relative">
        {hasVideo ? (
          <video className="w-full h-full object-cover" controls playsInline poster="/demo-poster.png">
            <source src="/demo.mp4" type="video/mp4" />
          </video>
        ) : (
          <div className="relative h-full flex flex-col items-center justify-center gap-2.5 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center">
              <Play className="w-5 h-5 text-white ml-0.5" fill="white" fillOpacity={0.85} />
            </div>
            <p className="text-white/80 text-sm font-medium">Demo video</p>
            <p className="text-white/40 text-xs">
              Drop <code className="text-white/55">public/demo.mp4</code> when ready
            </p>
          </div>
        )}
      </div>
    </BentoCard>
  )
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const { push: pushToast } = useToast()

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

  return (
    <div className="min-h-screen bg-background text-foreground antialiased pb-20 md:pb-0">
      <TopNav />

      {/* Hero */}
      <section className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-gutter sm:px-gutter py-12 lg:py-20">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <motion.div variants={stagger(0.05)} initial="hidden" animate="show">
              <motion.div variants={fadeUp} className="mb-5">
                <Badge tone="primary" dot>Autonomous PR agent</Badge>
              </motion.div>
              <motion.h1
                variants={fadeUp}
                className="text-4xl sm:text-5xl lg:text-[66px] font-bold tracking-tight leading-[1.08] text-foreground"
              >
                Issue → pull request.
                <span className="block text-muted-foreground font-semibold mt-2">Automatically.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-muted-foreground text-base sm:text-lg mt-5 mb-8 max-w-md" style={{ lineHeight: 'var(--leading-body)' }}>
                Paste a GitHub issue URL. Get a PR with live logs.
              </motion.p>
              <motion.form variants={fadeUp} onSubmit={handleSubmit} className="max-w-md">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="github.com/owner/repo/issues/42"
                      disabled={loading}
                    />
                  </div>
                  <Button type="submit" loading={loading} className="shrink-0">
                    {user ? 'Start' : 'Sign in'}
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </Button>
                </div>
                {!user && (
                  <p className="text-muted-foreground text-xs mt-2">
                    <button type="button" onClick={() => login('/tasks/new')} className="text-primary hover:underline">
                      GitHub sign-in
                    </button>
                    {' '}required.
                  </p>
                )}
              </motion.form>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="hidden lg:block"
            >
              <TaskViewMock />
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-gutter sm:px-gutter py-12 lg:py-16">
        <SectionHeader
          eyebrow="How it works"
          title="Issue in, PR out"
          description="Four steps. Your repo, your GitHub account, your branch."
          className="mb-8"
        />
        <BentoCard interactive={false}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {FLOW.map((step, i) => (
              <div key={step.label} className="p-5">
                <FlowStep {...step} step={i + 1} />
              </div>
            ))}
          </div>
        </BentoCard>
      </section>

      {/* Product */}
      <section className="max-w-6xl mx-auto px-gutter sm:px-gutter pb-12 lg:pb-16">
        <SectionHeader
          eyebrow="Product"
          title="Built for real repos"
          description="Live logs, sandboxed execution, and budget controls."
          className="mb-8"
        />

        {/* Row 1: live run + benefits */}
        <div className="grid lg:grid-cols-3 gap-4 mb-4 items-stretch">
          <div className="lg:col-span-2 flex min-w-0">
            <div className="w-full">
              <LiveRunCard />
            </div>
          </div>
          <BenefitsCard />
        </div>

        {/* Row 2: pillars */}
        <div className="grid sm:grid-cols-3 gap-4 items-stretch">
          {PILLARS.map((p) => (
            <PillarCard key={p.n} {...p} />
          ))}
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-gutter sm:px-gutter">
        <Separator />
      </div>

      {/* Demo + outcome */}
      <section className="max-w-6xl mx-auto px-gutter sm:px-gutter py-12 lg:py-16 space-y-5">
        <SectionHeader
          eyebrow="Demo"
          title="See it work"
          description="Full run — issue in, pull request out."
          className="mb-0"
        />
        <DemoVideo />
        <GitHubFlowStrip />
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-7">
        <div className="max-w-6xl mx-auto px-gutter sm:px-gutter flex items-center justify-between gap-4">
          <Logo height={36} linked={false} animated={false} />
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <span>GitHub Issues</span>
            <span>OAuth</span>
            <span>Pull Requests</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">MIT</span>
          </div>
        </div>
      </footer>
      <MobileBottomNav />
    </div>
  )
}
