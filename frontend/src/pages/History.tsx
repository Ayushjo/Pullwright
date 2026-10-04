import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ExternalLink, ChevronDown, GitPullRequest, Clock, History as HistoryIcon } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Button, EmptyState, Input, Badge, PageHeader, Skeleton, Tabs, type TabItem } from '../components/ui'
import { listTasks, getTaskMetrics } from '../api/client'
import type { TaskRegistryEntry, TaskStatus } from '../types/task'
import { fadeUp, stagger } from '../lib/motion'
import { statusMeta } from '../lib/status'

/* ── helpers ── */
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const tgt = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (tgt.getTime() === today.getTime()) return 'Today'
  if (tgt.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function repoFromUrl(url: string) {
  return url.replace('https://github.com/', '').split('/').slice(0, 2).join('/')
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatCost(usd: number): string {
  if (!usd || usd === 0) return '—'
  return `$${usd.toFixed(4)}`
}

/* ── status badge helper ── */
// Shared labels and tones (lib/status), so History says "Paused", "Review plan", etc. like everywhere else.
const statusTone = (status: string) => statusMeta(status).tone
const statusLabel = (status: string) => statusMeta(status).label

/* ── Expanded metrics row ── */
interface ExpandedMetrics {
  durationMs?: number
  costUsd?: number
  retries?: number
  toolCalls?: number
  llmCalls?: number
}

function ExpandedRow({ taskId, prUrl }: { taskId: string; prUrl?: string }) {
  const [metrics, setMetrics] = useState<ExpandedMetrics | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(true)

  useEffect(() => {
    getTaskMetrics(taskId)
      .then((m) => setMetrics(m ?? null))
      .finally(() => setLoadingMetrics(false))
  }, [taskId])

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="mx-3 sm:mx-4 mb-3 p-4 rounded-md border border-hairline bg-background/70">
        {loadingMetrics ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
            <MetricChip icon={<Clock className="w-3.5 h-3.5" />} label="Duration" value={formatDuration(metrics.durationMs ?? 0)} />
            <MetricChip label="Cost" value={formatCost(metrics.costUsd ?? 0)} />
            <MetricChip label="LLM Calls" value={String(metrics.llmCalls ?? '—')} />
            <MetricChip label="Tool Calls" value={String(metrics.toolCalls ?? '—')} />
            <MetricChip label="Retries" value={String(metrics.retries ?? 0)} />
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">No metrics available</p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mt-4 sm:justify-end">
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-xs text-foreground border border-black/15 px-3.5 py-1.5 rounded-pill hover:bg-black/[.04] transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              View PR
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <Link
            to={`/tasks/${taskId}`}
            className="inline-flex items-center justify-center gap-1.5 text-xs text-primary-foreground bg-primary px-3.5 py-1.5 rounded-pill hover:brightness-95 transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            Open task
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function MetricChip({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.08em]">{label}</p>
      <p className="text-sm font-mono text-foreground tabular-nums flex items-center gap-1 mt-1">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {value}
      </p>
    </div>
  )
}

/* ── Task row ── */
function TaskRow({ entry }: { entry: TaskRegistryEntry }) {
  const [expanded, setExpanded] = useState(false)
  const repo = repoFromUrl(entry.issueUrl)

  return (
    <div className="rounded-lg border border-hairline bg-card overflow-hidden hover:border-black/15 transition-colors">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full text-left px-4 sm:px-5 py-3.5 flex items-center gap-3 group focus-ring"
      >
        {/* Status badge */}
        <Badge tone={statusTone(entry.status)} dot className="shrink-0">
          {statusLabel(entry.status)}
        </Badge>

        {/* Title + repo */}
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {entry.issueNumber ? `#${entry.issueNumber} — ` : ''}
            {entry.issueTitle || `Task ${entry.taskId.slice(0, 8)}`}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground mt-0.5 truncate">{repo}</p>
        </div>

        {/* Time ago */}
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground shrink-0 hidden sm:block">
          {timeAgo(entry.createdAt)}
        </span>

        {/* Chevron */}
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted-foreground shrink-0"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && <ExpandedRow taskId={entry.taskId} prUrl={entry.prUrl} />}
      </AnimatePresence>
    </div>
  )
}

/* ── Day group ── */
function DayGroup({ label, entries }: { label: string; entries: TaskRegistryEntry[] }) {
  return (
    <motion.div variants={fadeUp} className="space-y-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground px-1 pt-2 mb-3">{label}</p>
      {entries.map((entry) => (
        <TaskRow key={entry.taskId} entry={entry} />
      ))}
    </motion.div>
  )
}

/* ── Skeleton loading state ── */
function HistorySkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-20 rounded mb-3" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Filter tabs ── */
// Same groups as the Dashboard (raw statuses missed "PR opened", "Paused", "Ready to publish", …).
type Filter = 'all' | 'needs_you' | 'active' | 'done' | 'failed'

const FILTER_TABS: TabItem<Filter>[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_you', label: 'Needs you' },
  { key: 'active', label: 'Running' },
  { key: 'done', label: 'Shipped' },
  { key: 'failed', label: 'Failed' },
]

function matches(filter: Filter, status: TaskStatus): boolean {
  const m = statusMeta(status)
  if (filter === 'all') return true
  if (filter === 'needs_you') return Boolean(m.needsYou)
  if (filter === 'active') return m.active
  if (filter === 'done') return status === 'published' || status === 'done'
  return status === 'failed' || status === 'cancelled'
}

/* ── Main export ── */
export default function History() {
  const [tasks, setTasks] = useState<TaskRegistryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    void listTasks().then((data) => {
      setTasks(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  // Filter + search
  const visible = tasks.filter((t) => {
    if (!matches(filter, t.status as TaskStatus)) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const title = (t.issueTitle ?? '').toLowerCase()
      const repo = repoFromUrl(t.issueUrl).toLowerCase()
      if (!title.includes(q) && !repo.includes(q)) return false
    }
    return true
  })

  // Group by day
  const groups = visible.reduce<Record<string, TaskRegistryEntry[]>>((acc, t) => {
    const label = dayLabel(t.createdAt)
    if (!acc[label]) acc[label] = []
    acc[label].push(t)
    return acc
  }, {})

  const orderedLabels = Array.from(
    new Set(visible.map((t) => dayLabel(t.createdAt))),
  )

  return (
    <AppShell>
      <PageHeader title="History" description="All your agent runs, grouped by day." />

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6 border-b border-hairline pb-0 sm:pb-0">
        <div className="flex-1 max-w-sm pb-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or repo…"
            icon={<Search className="w-4 h-4" />}
          />
        </div>
        <Tabs
          items={FILTER_TABS.map((f) => ({ ...f, count: tasks.filter((t) => matches(f.key, t.status as TaskStatus)).length }))}
          value={filter}
          onChange={setFilter}
          layoutId="history-tabs"
        />
      </div>

      {/* Content */}
      {loading ? (
        <HistorySkeleton />
      ) : visible.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <EmptyState
            icon={tasks.length === 0 ? HistoryIcon : Search}
            title={tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}
            text={tasks.length === 0 ? 'Submit a GitHub issue to get started.' : 'Try a different search or filter.'}
            action={
              tasks.length === 0 && (
                <Link to="/tasks/new" tabIndex={-1}>
                  <Button variant="primary" shape="pill" className="px-4">
                    Submit your first issue
                  </Button>
                </Link>
              )
            }
          />
        </motion.div>
      ) : (
        <motion.div
          variants={stagger(0.08)}
          initial="hidden"
          animate="show"
          className="space-y-8"
        >
          {orderedLabels.map((label) => (
            <DayGroup key={label} label={label} entries={groups[label] ?? []} />
          ))}
        </motion.div>
      )}
    </AppShell>
  )
}
