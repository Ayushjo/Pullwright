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

  const progressColor = task.status === 'failed' ? 'bg-danger' : task.status === 'done' || task.status === 'published' ? 'bg-success' : 'bg-primary'
  const live = statusMeta(task.status).active

  return (
    <Link
      to={`/tasks/${task.id}`}
      className={cn(
        'block bg-card rounded-lg border border-hairline p-4 sm:px-5 group',
        'hover:border-black/15 hover:shadow-[0_4px_16px_-10px_rgba(0,0,0,0.15)] transition-[border-color,box-shadow] duration-micro',
      )}
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
            {/* Live tasks show the pulsing dot instead of the badge's static one. */}
            <Badge tone={statusTone(task.status)} dot={!live}>
              <StatusDot status={task.status} />
              {statusLabel(task.status)}
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{timeAgo(task.createdAt)}</span>
          </div>

          <p className="text-foreground text-[15px] font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {task.issueNumber > 0 ? `#${task.issueNumber} — ` : ''}
            {task.issueTitle}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <span
              className="font-mono text-[10.5px] text-foreground/70 bg-black/[.04] px-1.5 py-0.5 rounded border border-black/[.06] truncate max-w-[200px]"
              title={task.branchName}
            >
              {task.branchName}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground truncate">{task.repoName}</span>
          </div>
        </div>

        {total > 0 && (
          <div className="shrink-0 w-[92px] flex flex-col justify-center items-end self-stretch py-0.5">
            <p className="font-mono text-[11px] text-muted-foreground tabular-nums mb-2">
              {done}/{total} steps
            </p>
            <div className="w-full h-1 bg-black/[.06] rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full transition-all duration-200', progressColor)} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
