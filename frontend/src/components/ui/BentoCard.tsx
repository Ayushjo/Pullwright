import { type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type BentoCardProps = React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean
}

function BentoCard({ className, interactive = true, children, ...props }: BentoCardProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-lg border border-hairline bg-card overflow-hidden',
        interactive && 'transition-colors duration-micro hover:border-black/15',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function BentoHeader({
  className,
  children,
  action,
}: {
  className?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-5 py-3.5 border-b border-hairline bg-card shrink-0',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function BentoContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-6 flex-1', className)}>{children}</div>
}

export { BentoCard, BentoHeader, BentoContent }
