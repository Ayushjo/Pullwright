import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

/** "Nothing here yet" block for app lists: icon, title, one line, optional action. */
export default function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  text?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-dashed border-black/15 bg-card px-6 py-14 flex flex-col items-center text-center', className)}>
      <Icon className="w-6 h-6 text-foreground/50" strokeWidth={1.5} />
      <p className="mt-4 text-[17px] text-foreground">{title}</p>
      {text && <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
