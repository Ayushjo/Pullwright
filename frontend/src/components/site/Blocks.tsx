import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { fadeUp } from '../../lib/motion'
import { ArrowLink, MonoLabel } from './Typography'

const inView = { initial: 'hidden', whileInView: 'show', viewport: { once: true, margin: '-80px' }, variants: fadeUp } as const

/** Media on top, then a title, a grey description and an optional link. `lg` = two per row, `sm` = three. */
export function FeatureCard({
  media,
  title,
  text,
  link,
  size = 'lg',
}: {
  media: ReactNode
  title: string
  text: ReactNode
  link?: { to: string; label: string }
  size?: 'lg' | 'sm'
}) {
  return (
    <motion.div {...inView} className="flex flex-col min-w-0">
      <div className={cn('rounded-lg overflow-hidden', size === 'lg' ? 'aspect-[16/11]' : 'aspect-[4/3]')}>{media}</div>
      <h3 className={cn('mt-5 font-normal text-foreground tracking-[-0.01em]', size === 'lg' ? 'text-[22px]' : 'text-[19px]')}>{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground max-w-[46ch]">{text}</p>
      {link && <ArrowLink to={link.to} className="mt-3">{link.label}</ArrowLink>}
    </motion.div>
  )
}

/** Numbered zig-zag row: text on one side, a product shot on the other (`flip` swaps them on desktop). */
export function StepRow({
  n,
  title,
  text,
  link,
  media,
  flip,
}: {
  n: string
  title: string
  text: ReactNode
  link?: { to: string; label: string }
  media: ReactNode
  flip?: boolean
}) {
  return (
    <motion.div {...inView} className="grid gap-8 md:gap-14 md:grid-cols-2 md:items-center">
      <div className={cn('min-w-0', flip && 'md:order-2')}>
        <span className="block font-normal text-[40px] leading-none text-faint tracking-[-0.03em]">{n}</span>
        <h3 className="mt-3 text-[30px] sm:text-[34px] font-normal text-foreground tracking-[-0.02em] leading-tight">{title}</h3>
        <p className="mt-3 text-[15px] sm:text-base leading-relaxed text-muted-foreground max-w-[48ch]">{text}</p>
        {link && <ArrowLink to={link.to} className="mt-4">{link.label}</ArrowLink>}
      </div>
      <div className={cn('min-w-0', flip && 'md:order-1')}>{media}</div>
    </motion.div>
  )
}

/** Cells separated by hairlines: an icon, a short title and one line. */
export function IconGrid({
  items,
  cols = 4,
  className,
}: {
  items: { icon: LucideIcon | ((p: { className?: string }) => ReactNode); title: string; line: string }[]
  cols?: 2 | 3 | 4
  className?: string
}) {
  const grid = cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
  return (
    <div className={cn('grid grid-cols-1 border-t border-l border-hairline', grid, className)}>
      {items.map(({ icon: Icon, title, line }) => (
        <div key={title} className="border-b border-r border-hairline p-5 sm:p-6 min-w-0">
          <Icon className="w-6 h-6 text-foreground/70" />
          <p className="mt-6 text-[15px] text-foreground">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{line}</p>
        </div>
      ))}
    </div>
  )
}

export type ChangelogEntry = { date: string; title: string; tag: string; href?: string }

/** Dated rows with hairlines between them, like devin.ai's "Recently shipped". */
export function ChangelogList({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <ul className="divide-y divide-hairline border-y border-hairline">
      {entries.map((e) => {
        const row = (
          <>
            <MonoLabel className="w-14 shrink-0 text-[13px] tracking-normal">{e.date}</MonoLabel>
            <span className="flex-1 min-w-0 truncate text-[15px] sm:text-[17px] text-foreground">{e.title}</span>
            <span className="hidden sm:inline text-sm text-muted-foreground w-28 shrink-0">{e.tag}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </>
        )
        const cls = 'flex items-center gap-4 py-3.5 sm:py-4'
        return (
          <li key={e.date + e.title}>
            {e.href ? (
              /^https?:/.test(e.href) ? (
                <a href={e.href} target="_blank" rel="noreferrer" className={cn(cls, 'hover:bg-black/[.02] transition-colors')}>
                  {row}
                </a>
              ) : (
                <Link to={e.href} className={cn(cls, 'hover:bg-black/[.02] transition-colors')}>
                  {row}
                </Link>
              )
            ) : (
              <div className={cls}>{row}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
