import { motion } from 'framer-motion'
import { Code2, Eye, ScanSearch } from 'lucide-react'
import type { WalletCapability } from '../../api/client'
import { HandCheck } from '../hand/Scribbles'
import { cn } from '../../lib/cn'

/** What the saved keys let Pullwright do right now: plan and write code, review, read screenshots. */
export default function CapabilityStrip({ cap }: { cap: WalletCapability }) {
  const items = [
    { on: cap.canRun, label: 'Plan & write code', icon: Code2 },
    { on: cap.canReview, label: 'Review patches', icon: ScanSearch },
    { on: cap.canReadImages, label: 'Read screenshots', icon: Eye },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 border border-hairline rounded-md overflow-hidden">
      {items.map((it, i) => (
        <motion.div
          key={it.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.25 }}
          className={cn(
            // One hairline box, three cells: stacked on phones, side by side from sm.
            'flex items-center gap-2.5 px-3.5 py-3 text-sm transition-colors border-hairline [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l',
            it.on ? 'bg-primary/[.04] text-foreground' : 'text-muted-foreground',
          )}
        >
          <it.icon className={cn('w-4 h-4 shrink-0', it.on ? 'text-primary' : 'text-muted-foreground/70')} strokeWidth={1.75} />
          <span className="truncate">{it.label}</span>
          <span className="ml-auto shrink-0">
            {it.on ? <HandCheck className="w-5 h-5 text-primary" delay={0.15 + i * 0.1} /> : <span className="font-mono text-[10.5px] uppercase tracking-[0.06em]">not yet</span>}
          </span>
        </motion.div>
      ))}
    </div>
  )
}
