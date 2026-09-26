import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, TrendingUp, Zap, CheckCircle, BellDot as XCircle } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Tabs, Skeleton, type TabItem } from '../components/ui'
import TaskCard from '../components/TaskCard'
import type { StoredTask } from '../store/taskStore'
import { statusMeta } from '../lib/status'
import { listTasks, getStats, type StatsResponse } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { TaskStatus, TaskRegistryEntry } from '../types/task'
import { fadeUp, stagger } from '../lib/motion'

/* ── Count-up hook ── */
function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const start = performance.now()
    const from = 0
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])

  return value
}

/* ── Stat card ── */
interface StatCardProps {
  label: string
  value: number
  icon: React.ReactNode
  color: string
  bgColor: string
}

function StatCard({ label, value, icon, color, bgColor }: StatCardProps) {
  const animated = useCountUp(value)
  return (
    <motion.div
      variants={fadeUp}
      className="bg-card rounded-xl border border-border p-5 flex items-start gap-4 transition-colors hover:bg-muted/40"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: bgColor }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground tabular-nums">{animated}</p>
        <p className="text-muted-foreground text-xs mt-0.5">{label}</p>
      </div>
    </motion.div>
  )
}

/* ── Filter tabs ── */
type Filter = 'all' | 'needs_you' | 'active' | 'done' | 'failed'

const FILTER_TABS: TabItem<Filter>[] = [
  { key: 'all',       label: 'All' },
  { key: 'needs_you', label: 'Needs you' },
  { key: 'active',    label: 'Running' },
  { key: 'done',      label: 'Shipped' },
  { key: 'failed',    label: 'Failed' },
]

function matches(filter: Filter, status: TaskStatus): boolean {
  const m = statusMeta(status)
  if (filter === 'all') return true
  if (filter === 'needs_you') return Boolean(m.needsYou)
  if (filter === 'active') return m.active
  if (filter === 'done') return status === 'published' || status === 'done'
  return status === 'failed' || status === 'cancelled'
}

/* ── Empty state ── */
function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
        <Zap className="w-7 h-7 text-primary" />
      </div>
      <h3 className="text-foreground font-semibold text-lg mb-2">No tasks yet</h3>
      <p className="text-muted-foreground text-sm mb-6 max-w-xs">
        Submit a GitHub issue URL and Pullwright will plan, execute, and open a PR automatically.
      </p>
      <Link
        to="/tasks/new"
        className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-button bg-primary text-primary-foreground hover:brightness-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        Submit first issue
      </Link>
    </motion.div>
  )
}

/* ── Main export ── */
export default function Dashboard() {
  const { user } = useAuth()
  const [filter, setFilter] = useState<Filter>('all')
  const [allTasks, setAllTasks] = useState<StoredTask[]>([])
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  useEffect(() => {
    function fromServer(serverTasks: TaskRegistryEntry[]): StoredTask[] {
      return serverTasks
        .map((st) => ({
          id: st.taskId,
          issueUrl: st.issueUrl,
          issueTitle: st.issueTitle,
          issueNumber: st.issueNumber,
          repoName: st.issueUrl.startsWith('local://') ? st.issueUrl.replace('local://', 'local · ') : st.issueUrl.replace('https://github.com/', '').split('/').slice(0, 2).join('/'),
          branchName: st.prUrl ? st.prUrl.replace('https://github.com/', '') : `#${st.issueNumber}`,
          status: st.status,
          steps: [],
          createdAt: st.createdAt,
          ...(st.prUrl ? { prUrl: st.prUrl } : {}),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }

    async function refresh() {
      const [statsRes, tasksRes] = await Promise.allSettled([getStats(), listTasks()])
      if (statsRes.status === 'fulfilled' && statsRes.value) setStats(statsRes.value)
      if (tasksRes.status === 'fulfilled') setAllTasks(fromServer(tasksRes.value as TaskRegistryEntry[]))
    }

    let cancelled = false
    refresh().finally(() => { if (!cancelled) setLoading(false) })

    const interval = window.setInterval(() => {
      refresh().catch(() => {})
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const filtered = allTasks.filter((t) => matches(filter, t.status))

  const totalVal = stats?.total ?? allTasks.length
  const needsYouVal = stats?.needsYou ?? allTasks.filter((t) => statusMeta(t.status).needsYou).length
  const runningVal = stats?.running ?? allTasks.filter((t) => statusMeta(t.status).active).length
  const doneVal = stats?.done ?? allTasks.filter((t) => matches('done', t.status)).length

  const statCards: StatCardProps[] = [
    { label: 'Total Tasks', value: totalVal, icon: <TrendingUp className="w-5 h-5" />, color: '#000000', bgColor: '#F2F2F2' },
    { label: 'Needs you', value: needsYouVal, icon: <XCircle className="w-5 h-5" />, color: '#2B7FFF', bgColor: '#E8F2FF' },
    { label: 'Running', value: runningVal, icon: <Zap className="w-5 h-5" />, color: '#BF8700', bgColor: '#FFF8E6' },
    { label: 'Shipped', value: doneVal, icon: <CheckCircle className="w-5 h-5" />, color: '#1A7F37', bgColor: '#EEF9F1' },
  ]

  return (
    <AppShell>
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-8 flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {greeting()}{user?.name ?? user?.login ? `, ${user.name ?? user.login}` : ''} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Here's everything your agent has been working on.</p>
        </div>
        <Link
          to="/tasks/new"
          className="hidden sm:inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-button bg-primary text-primary-foreground hover:brightness-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          New Task
        </Link>
      </motion.div>

      {/* Stats strip */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <motion.div
          variants={stagger(0.07)}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8"
        >
          {statCards.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </motion.div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-3 mb-5">
        <Tabs
          items={FILTER_TABS.map((f) => ({
            ...f,
            count: allTasks.filter((t) => matches(f.key, t.status)).length,
          }))}
          value={filter}
          onChange={setFilter}
          layoutId="dashboard-tabs"
        />
      </div>

      {/* Task list */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl mb-2.5" />
            ))}
          </motion.div>
        ) : allTasks.length === 0 ? (
          <EmptyState key="empty" />
        ) : filtered.length === 0 ? (
          <motion.p
            key="none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-muted-foreground text-sm py-12 text-center"
          >
            Nothing here yet.
          </motion.p>
        ) : (
          <motion.div
            key="list"
            variants={stagger(0.05)}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-2"
          >
            {filtered.map((task) => (
              <motion.div key={task.id} variants={fadeUp}>
                <TaskCard task={task} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  )
}
