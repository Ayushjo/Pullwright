import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Inbox } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Button, EmptyState, PageHeader, Tabs, Skeleton, type TabItem } from '../components/ui'
import TaskCard from '../components/TaskCard'
import type { StoredTask } from '../store/taskStore'
import { statusMeta } from '../lib/status'
import { listTasks, getStats, type StatsResponse } from '../api/client'
import CapacityMeter from '../components/wallet/CapacityMeter'
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

/* ── Stat cell (one of four in a hairline grid) ── */
interface StatCardProps {
  label: string
  value: number
  /** Status-colour dot: matches what the number counts. */
  dot: string
}

function StatCard({ label, value, dot }: StatCardProps) {
  const animated = useCountUp(value)
  return (
    // Hairlines between cells: 2×2 on phones, 1×4 from sm.
    <motion.div
      variants={fadeUp}
      className="p-5 sm:p-6 min-w-0 border-hairline [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0 sm:[&:not(:first-child)]:border-l"
    >
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground truncate">{label}</span>
      </div>
      <p className="mt-4 text-[34px] leading-none font-normal tracking-[-0.02em] text-foreground tabular-nums">{animated}</p>
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

  // Count from the same list the tabs filter, so the cards and tab badges always agree; the stats
  // endpoint (Postgres only) is the fallback when the list is empty or failed to load.
  const fromList = allTasks.length > 0
  const totalVal = fromList ? allTasks.length : (stats?.total ?? 0)
  const needsYouVal = fromList ? allTasks.filter((t) => matches('needs_you', t.status)).length : (stats?.needsYou ?? 0)
  const runningVal = fromList ? allTasks.filter((t) => matches('active', t.status)).length : (stats?.running ?? 0)
  const doneVal = fromList ? allTasks.filter((t) => matches('done', t.status)).length : (stats?.done ?? 0)

  const statCards: StatCardProps[] = [
    { label: 'Total tasks', value: totalVal, dot: 'bg-foreground/40' },
    { label: 'Needs you', value: needsYouVal, dot: 'bg-primary' },
    { label: 'Running', value: runningVal, dot: 'bg-foreground/70' },
    { label: 'Shipped', value: doneVal, dot: 'bg-success' },
  ]

  return (
    <AppShell>
      <PageHeader
        title={`${greeting()}${user?.name ?? user?.login ? `, ${user.name ?? user.login}` : ''}`}
        description="Here’s everything your agent has been working on."
      />

      <CapacityMeter className="-mt-2 mb-6 w-fit max-w-full" />

      {/* Stats strip */}
      {loading ? (
        <Skeleton className="h-[106px] rounded-lg mb-8" />
      ) : (
        <motion.div
          variants={stagger(0.07)}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 sm:grid-cols-4 bg-card border border-hairline rounded-lg overflow-hidden mb-8"
        >
          {statCards.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </motion.div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-3 mb-5 border-b border-hairline">
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
              <Skeleton key={i} className="h-[88px] rounded-lg mb-2" />
            ))}
          </motion.div>
        ) : allTasks.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <EmptyState
              icon={Inbox}
              title="No tasks yet"
              text="Paste a GitHub issue URL and Pullwright will plan, run and open a PR when you say so."
              action={
                <Link to="/tasks/new" tabIndex={-1}>
                  <Button variant="primary" shape="pill" className="gap-1.5 px-4">
                    <Plus className="w-4 h-4" />
                    Submit your first issue
                  </Button>
                </Link>
              }
            />
          </motion.div>
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
