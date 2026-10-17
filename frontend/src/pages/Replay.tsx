import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowUpRight, Pause, Play, RotateCcw } from 'lucide-react'
import ActivityFeed from '../components/task/ActivityFeed'
import DiffView from '../components/task/DiffView'
import { Badge, Button, Tabs } from '../components/ui'
import { getPublicEvents, getPublicTask } from '../api/client'
import type { TaskEvent } from '../types/task'
import { statusMeta } from '../lib/status'
import { cn } from '../lib/cn'
import { useAuth } from '../context/AuthContext'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame, Section } from '../components/site/Layout'
import { MonoLabel, TwoToneHeading } from '../components/site/Typography'
import { useSeo } from '../lib/seo'

type PublicTask = {
  title: string
  repo: string
  issueUrl: string
  issueNumber: number
  status: string
  prUrl?: string | null
  summary?: string | null
  costUsd?: number | null
  patch?: string | null
  createdAt: string
  completedAt?: string | null
}

const SPEEDS = [1, 5, 20, 50]
const HIDDEN = new Set(['llm_call', 'cost', 'checkpoint', 'metrics_update', 'phase_start', 'phase_end', 'plan_update', 'diff_ready'])

/**
 * Public replay of a real run (the owner chose to share it). Events are re-played on a
 * compressed timeline — watching costs nothing, no model is called.
 */
export default function Replay() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<PublicTask | null>(null)
  useSeo({
    title: task ? `Replay: ${task.title}` : 'Replay a real run',
    description: task ? `Watch Pullwright turn ${task.repo}#${task.issueNumber} into a reviewed pull request — the plan, the edits, the tests and the review, step by step.` : 'Watch a real Pullwright run, from GitHub issue to reviewed pull request.',
    path: `/r/${id ?? ''}`,
  })
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(20)
  const [tab, setTab] = useState<'activity' | 'changes'>('activity')
  const [error, setError] = useState<string | null>(null)
  const { user, login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    Promise.all([getPublicTask(id), getPublicEvents(id)])
      .then(([t, ev]) => {
        setTask(t as unknown as PublicTask)
        setEvents(ev)
      })
      .catch(() => setError('This replay is private or does not exist.'))
  }, [id])

  // Real gaps between events, compressed by `speed` and capped so long waits don't stall the demo.
  const delays = useMemo(
    () =>
      events.map((e, i) => {
        // Bookkeeping events are invisible in the feed — don't spend screen time on them.
        if (HIDDEN.has(e.type)) return 0
        const prev = events[i - 1]
        if (!prev?.timestamp || !e.timestamp) return 120
        const gap = Date.parse(e.timestamp) - Date.parse(prev.timestamp)
        return Math.min(1500, Math.max(60, gap))
      }),
    [events],
  )

  useEffect(() => {
    if (!playing || shown >= events.length) return
    const t = setTimeout(() => setShown((n) => n + 1), (delays[shown] ?? 120) / speed)
    return () => clearTimeout(t)
  }, [playing, shown, events.length, delays, speed])

  const visible = useMemo(() => events.slice(0, shown), [events, shown])
  const done = shown >= events.length && events.length > 0
  const meta = statusMeta(task?.status ?? 'queued')

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <SiteNav />
        <Frame>
          <Section divider={false} inner="py-28 text-center">
            <MonoLabel>Replay</MonoLabel>
            <p className="mt-4 text-2xl tracking-[-0.02em]">{error}</p>
            <Link to="/" className="mt-4 inline-block text-primary hover:underline underline-offset-4">
              Go to Pullwright →
            </Link>
          </Section>
        </Frame>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        {/* Title */}
        <section className="px-gutter md:px-12 pt-12 md:pt-16 pb-8">
          <MonoLabel dot>Live replay · sped up · no model is called</MonoLabel>
          <h1 className="mt-4 text-[30px] sm:text-[40px] font-normal leading-[1.1] tracking-[-0.025em] text-foreground max-w-4xl">{task?.title ?? 'Loading…'}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            <a href={task?.issueUrl} target="_blank" rel="noreferrer" className="font-mono text-[13px] hover:text-foreground">
              {task?.repo} #{task?.issueNumber}
            </a>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
          </div>
        </section>

        {/* Player */}
        <section className="px-gutter md:px-12 pb-16">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Button variant="primary" shape="pill" size="sm" className="px-4" onClick={() => (done ? (setShown(0), setPlaying(true)) : setPlaying((p) => !p))}>
              {done ? <RotateCcw className="w-3.5 h-3.5" /> : playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {done ? 'Replay' : playing ? 'Pause' : 'Play'}
            </Button>
            <div className="inline-flex rounded-pill border border-black/15 p-0.5" role="group" aria-label="Playback speed">
              {SPEEDS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpeed(sp)}
                  aria-pressed={speed === sp}
                  className={cn('px-2.5 py-1 rounded-pill font-mono text-[11px] transition-colors', speed === sp ? 'bg-foreground text-white' : 'text-muted-foreground hover:text-foreground')}
                >
                  {sp}×
                </button>
              ))}
            </div>
            <MonoLabel className="ml-auto tabular-nums">
              {shown}/{events.length} events{typeof task?.costUsd === 'number' ? ` · run cost $${task.costUsd.toFixed(4)}` : ''}
            </MonoLabel>
            {task?.prUrl && (
              <a href={task.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-pill border border-black/15 px-3 py-1 text-xs text-foreground hover:bg-black/[.04]">
                Pull request <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="rounded-lg border border-hairline bg-card overflow-hidden">
            <div className="px-4 sm:px-5 py-2.5 border-b border-hairline">
              <Tabs<'activity' | 'changes'>
                layoutId="replay-tabs"
                value={tab}
                onChange={setTab}
                items={[
                  { key: 'activity', label: 'Activity' },
                  { key: 'changes', label: 'Final diff' },
                ]}
              />
            </div>
            <div className="h-[65vh]">
              {tab === 'activity' ? (
                <ActivityFeed events={visible} live={!done && playing} />
              ) : (
                <div className="p-4 sm:p-5 h-full overflow-y-auto">
                  <DiffView patch={task?.patch ?? ''} rejected={[]} editable={false} />
                </div>
              )}
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Every step above really happened: plan → sandboxed edits → tests → independent review → pull request.
          </p>
        </section>

        <Section inner="py-20 md:py-28 text-center">
          <TwoToneHeading muted="Seen enough?" strong="Run it on your own issue." className="mx-auto max-w-2xl" />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button variant="primary" shape="pill" size="lg" onClick={() => (user ? navigate('/tasks/new') : login('/wallet'))}>
              Start free
            </Button>
            <Link to="/pricing">
              <Button variant="outline" shape="pill" size="lg" tabIndex={-1}>
                See pricing
              </Button>
            </Link>
          </div>
        </Section>
        <SiteFooter />
      </Frame>
    </div>
  )
}
