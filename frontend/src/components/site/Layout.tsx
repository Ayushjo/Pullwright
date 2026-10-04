import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * The marketing canvas: a centred 1400 px column whose hairline side borders run the full page height
 * (devin.ai's "graph paper" frame). Sections inside draw the horizontal lines.
 */
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-frame md:border-x border-hairline', className)}>{children}</div>
}

/** One horizontal band of a marketing page: hairline on top, standard rhythm and side padding. */
export function Section({
  children,
  id,
  className,
  inner,
  divider = true,
}: {
  children: ReactNode
  id?: string
  className?: string
  /** Extra classes for the padded inner wrapper. */
  inner?: string
  divider?: boolean
}) {
  return (
    <section id={id} className={cn(divider && 'border-t border-hairline', 'overflow-hidden', className)}>
      <div className={cn('px-gutter md:px-12 py-16 md:py-24', inner)}>{children}</div>
    </section>
  )
}
