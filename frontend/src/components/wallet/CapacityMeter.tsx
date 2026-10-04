import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { getCapacity, type Capacity } from '../../api/client'
import { cn } from '../../lib/cn'

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** One line: "2 of 3 free tasks left today", with a dot per task (filled = still available). */
export function capacityText(c: Capacity): { line: string; note: string | null; blocked: boolean } {
  const plan = c.tier === 'pro' ? '' : 'free '
  if (c.left === 0)
    return { line: `No ${plan}tasks left today`, note: c.nextSlotAt ? `Next one frees up at ${time(c.nextSlotAt)}` : null, blocked: true }
  if (c.active >= c.maxActive)
    return {
      line: `${c.left} of ${c.tasksPerDay} ${plan}tasks left today`,
      note: c.maxActive === 1 ? 'One task runs at a time on the free plan — finish or cancel the current one first' : `${c.active} tasks running — the limit is ${c.maxActive}`,
      blocked: true,
    }
  return { line: `${c.left} of ${c.tasksPerDay} ${plan}tasks left today`, note: null, blocked: false }
}

export default function CapacityMeter({ className, onLoad }: { className?: string; onLoad?: (c: Capacity) => void }) {
  const [cap, setCap] = useState<Capacity | null>(null)
  useEffect(() => {
    getCapacity()
      .then((c) => {
        setCap(c)
        onLoad?.(c)
      })
      .catch(() => setCap(null))
  }, [onLoad])
  if (!cap) return null
  const { line, note, blocked } = capacityText(cap)
  const dots = cap.tasksPerDay <= 5
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5', blocked ? 'border-amber-200 bg-amber-50/60' : 'border-border bg-card', className)}
      role="status"
    >
      {dots ? (
        <span className="flex items-center gap-1 pt-1 shrink-0" aria-hidden>
          {Array.from({ length: cap.tasksPerDay }).map((_, i) => {
            const available = i < cap.left
            return (
              <motion.span
                key={i}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1 + i * 0.08, type: 'spring', stiffness: 500, damping: 22 }}
                className={cn('w-2.5 h-2.5 rounded-full', available ? 'bg-primary' : 'border border-dashed border-neutral-400')}
              />
            )
          })}
        </span>
      ) : (
        <span className="mt-1.5 h-1.5 w-14 shrink-0 rounded-full bg-muted overflow-hidden" aria-hidden>
          <motion.span
            className="block h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(cap.left / cap.tasksPerDay) * 100}%` }}
            transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          />
        </span>
      )}
      <span className="min-w-0">
        <span className={cn('block text-[13px] font-medium', blocked ? 'text-amber-900' : 'text-foreground')}>{line}</span>
        {note && <span className="block text-xs text-amber-800/90 mt-0.5">{note}</span>}
      </span>
    </motion.div>
  )
}
