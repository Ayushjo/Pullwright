import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'
import { fadeUp } from '../../lib/motion'

/** Signed-in page title: optional mono eyebrow, a serif heading (the site's display face), grey description, right-hand action. */
export default function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <motion.div initial="hidden" animate="show" variants={fadeUp} className={cn('mb-7 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</div>}
        <h1 className="font-serif text-[36px] sm:text-[44px] font-normal leading-[1.02] tracking-[-0.015em] text-foreground">{title}</h1>
        {description && <div className="mt-1.5 text-sm sm:text-[15px] text-muted-foreground">{description}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </motion.div>
  )
}
