import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'

export type TabItem<T extends string> = { key: T; label: string; count?: number }

export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  layoutId = 'tab-pill',
}: {
  items: TabItem<T>[]
  value: T
  onChange: (v: T) => void
  layoutId?: string
}) {
  return (
    // Text tabs with a sliding 2px underline (devin.ai style). max-w-full + scroll: on a phone they scroll
    // sideways instead of widening the page.
    <div className="inline-flex max-w-full items-center gap-5 overflow-x-auto" style={{ scrollbarWidth: 'none' }} role="tablist">
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative shrink-0 whitespace-nowrap py-2 text-sm transition-colors duration-micro focus-ring rounded-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-1.5">
              {item.label}
              {item.count !== undefined && (
                <span className={cn('font-mono text-[11px] tabular-nums', active ? 'text-primary' : 'text-faint')}>{item.count}</span>
              )}
            </span>
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-foreground"
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
