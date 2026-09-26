import { Link } from 'react-router-dom'
import type { Task } from '../types/task'
import { Badge } from './ui'
import { cn } from '../lib/cn'
import { statusMeta } from '../lib/status'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const statusTone = (status: Task['status']) => statusMeta(status).tone
const statusLabel = (status: Task['status']) => statusMeta(status).label

function StatusDot({ status }: { status: Task['status'] }) {
  const isLive = statusMeta(status).active
  if (!isLive) return null
  return (
    <span className="relative flex items-center justify-center w-2 h-2 shrink-0">
      <span className="absolute w-2 h-2 rounded-full bg-primary/30 animate-ping" />
      <span className="relative w-1.5 h-1.5 rounded-full bg-primary" />
    </span>
  )
}

export default function TaskCard({ task }: { task: Task }) {
  const done = task.steps.filter((s) => s.status === 'done').length
  const total = task.steps.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const progressColor =
    task.status === 'failed' ? '#CF222E' : task.status === 'done' || task.status === 'published' ? '#1A7F37' : '#2B7FFF'

  return (
    <Link
      to={`/tasks/${task.id}`}
      className={cn(
        'block bg-card rounded-xl border border-border p-4 group',
        'hover:border-primary/40 transition-colors duration-micro',
      )}
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
            <Badge tone={statusTone(task.status)} dot>
              <StatusDot status={task.status} />
              {statusLabel(task.status)}
            </Badge>
            <span className="text-muted-foreground text-xs">{timeAgo(task.createdAt)}</span>
          </div>

          <p className="text-foreground text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {task.issueNumber > 0 ? `#${task.issueNumber} — ` : ''}
            {task.issueTitle}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <span
              className="font-mono text-[10.5px] text-primary bg-primary/5 px-2 py-0.5 rounded-md border border-primary/15 truncate max-w-[200px]"
              title={task.branchName}
            >
              {task.branchName}
            </span>
            <span className="text-muted-foreground text-xs truncate">{task.repoName}</span>
          </div>
        </div>

        {total > 0 && (
          <div className="shrink-0 w-[92px] flex flex-col justify-center items-end self-stretch py-0.5">
            <p className="text-xs font-medium text-muted-foreground tabular-nums mb-2">
              {done}/{total} steps
            </p>
            <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${pct}%`, background: progressColor }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
