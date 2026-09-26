import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Pause, Play, RotateCcw } from 'lucide-react'
import ActivityFeed from '../components/task/ActivityFeed'
import DiffView from '../components/task/DiffView'
import { Badge, Button, Tabs } from '../components/ui'
import { getPublicEvents, getPublicTask } from '../api/client'
import type { TaskEvent } from '../types/task'
import { statusMeta } from '../lib/status'
import { PullwrightIcon } from '../components/svgs/PullwrightMark'

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
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(20)
  const [tab, setTab] = useState<'activity' | 'changes'>('activity')
  const [error, setError] = useState<string | null>(null)

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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <p className="text-muted-foreground">{error}</p>
        <Link to="/" className="text-sm text-primary hover:underline">Go to Pullwright →</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-sm">
            <PullwrightIcon className="w-6 h-6" /> Pullwright
          </Link>
          <Link to="/login" className="text-xs font-medium text-primary hover:underline">Try it on your repo →</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-border bg-muted/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  Replay of a real run ·{' '}
                  <a href={task?.issueUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {task?.repo} #{task?.issueNumber}
                  </a>
                </p>
                <h1 className="text-lg font-bold leading-snug">{task?.title ?? 'Loading…'}</h1>
              </div>
              <Badge tone={meta.tone} dot>{meta.label}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => (done ? (setShown(0), setPlaying(true)) : setPlaying((p) => !p))}>
                {done ? <RotateCcw className="w-3.5 h-3.5" /> : playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {done ? 'Replay' : playing ? 'Pause' : 'Play'}
              </Button>
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" onClick={() => setSpeed(s)} className={`px-2.5 py-1 text-xs ${speed === s ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground'}`}>
                    {s}×
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                {shown}/{events.length} events{typeof task?.costUsd === 'number' ? ` · run cost $${task.costUsd.toFixed(4)}` : ''}
              </span>
              {task?.prUrl && (
                <a href={task.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Pull request
                </a>
              )}
            </div>
          </div>
          <div className="px-4 sm:px-5 py-2.5 border-b border-border">
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
        <p className="text-center text-xs text-muted-foreground mt-4">
          Every step above really happened: plan → sandboxed edits → tests → independent review → pull request.
        </p>
      </main>
    </div>
  )
}
