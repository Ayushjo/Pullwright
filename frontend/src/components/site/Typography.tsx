import type { ElementType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * Two-tone headline: a grey lead-in, then the strong line (devin.ai's signature). Weight 400 and tight
 * tracking; either half may be omitted.
 */
export function TwoToneHeading({
  muted,
  strong,
  as: Tag = 'h2',
  size = 'title',
  className,
}: {
  muted?: ReactNode
  strong?: ReactNode
  as?: ElementType
  size?: 'title' | 'display'
  className?: string
}) {
  return (
    <Tag className={cn('font-normal text-foreground text-balance', size === 'display' ? 'text-display' : 'text-title', className)}>
      {muted && <span className="text-faint">{muted}</span>}
      {muted && strong && <br />}
      {strong}
    </Tag>
  )
}

/** Small uppercase mono label: section tags, column headers, dates, "[01]" indexes. */
export function MonoLabel({
  children,
  index,
  dot,
  className,
}: {
  children?: ReactNode
  index?: string
  dot?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground', className)}>
      {dot && <span aria-hidden className="w-1.5 h-1.5 bg-primary" />}
      {index && <span className="text-faint">[{index}]</span>}
      {children}
    </span>
  )
}

/** "Explore X ›" link in the accent colour; external hrefs open in a new tab, #anchors scroll in place. */
export function ArrowLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const cls = cn('group inline-flex items-center gap-1 text-[15px] text-primary hover:underline underline-offset-4', className)
  const body = (
    <>
      {children}
      <ChevronRight className="w-4 h-4 transition-transform duration-micro group-hover:translate-x-0.5" />
    </>
  )
  if (/^https?:/.test(to))
    return (
      <a href={to} target="_blank" rel="noreferrer" className={cls}>
        {body}
      </a>
    )
  if (to.startsWith('#'))
    return (
      <a href={to} className={cls}>
        {body}
      </a>
    )
  return (
    <Link to={to} className={cls}>
      {body}
    </Link>
  )
}
