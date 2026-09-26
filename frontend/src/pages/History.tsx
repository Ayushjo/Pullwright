import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ExternalLink, ChevronDown, GitPullRequest, Clock } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Input, Badge, Skeleton, Tabs, type TabItem } from '../components/ui'
import { listTasks, getTaskMetrics } from '../api/client'
import type { TaskRegistryEntry, TaskStatus } from '../types/task'
import { fadeUp, stagger } from '../lib/motion'

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
function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'primary' {
  if (status === 'done') return 'success'
  if (status === 'running' || status === 'planning') return 'primary'
  if (status === 'failed') return 'danger'
  if (status === 'queued') return 'warning'
  return 'neutral'
}

function statusLabel(status: string): string {
  if (status === 'done') return 'Done'
  if (status === 'running') return 'Running'
  if (status === 'planning') return 'Planning'
  if (status === 'failed') return 'Failed'
  if (status === 'queued') return 'Queued'
  return status
}

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
      <div
        className="mx-3 sm:mx-4 mb-3 p-4 rounded-xl border border-border bg-muted"
      >
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
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-success bg-green-50 border border-green-200 px-3 py-2 rounded-lg hover:bg-green-100 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              View PR
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <Link
            to={`/tasks/${taskId}`}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-foreground bg-primary border border-primary px-3 py-2 rounded-lg hover:brightness-95 transition-all"
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
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className="text-sm font-semibold font-mono text-foreground tabular-nums flex items-center gap-1 mt-0.5">
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
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-primary/5 transition-colors group"
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
          <p className="text-muted-foreground text-xs mt-0.5 truncate">{repo}</p>
        </div>

        {/* Time ago */}
        <span className="text-muted-foreground text-xs shrink-0 hidden sm:block">
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
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest px-1 mb-3">{label}</p>
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
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Filter tabs ── */
type Filter = 'all' | TaskStatus

const FILTER_TABS: TabItem<Filter>[] = [
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Done' },
  { key: 'running', label: 'Running' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
]

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
    if (filter !== 'all' && t.status !== filter) return false
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
      {/* Page header */}
      <div className="mb-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <h1 className="text-2xl font-bold text-foreground mb-1">History</h1>
          <p className="text-muted-foreground text-sm">All your agent runs, grouped by day.</p>
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or repo…"
            icon={<Search className="w-4 h-4" />}
          />
        </div>
        <Tabs items={FILTER_TABS} value={filter} onChange={setFilter} layoutId="history-tabs" />
      </div>

      {/* Content */}
      {loading ? (
        <HistorySkeleton />
      ) : visible.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-24 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <Clock className="w-6 h-6 text-primary" />
          </div>
          <p className="text-foreground font-semibold mb-1">
            {tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}
          </p>
          <p className="text-muted-foreground text-sm mb-6">
            {tasks.length === 0
              ? 'Submit a GitHub issue to get started.'
              : 'Try a different search or filter.'}
          </p>
          {tasks.length === 0 && (
            <Link
              to="/tasks/new"
              className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-button bg-primary text-primary-foreground hover:brightness-95 transition-all"
            >
              Submit first issue
            </Link>
          )}
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
