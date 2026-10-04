import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

const BACKDROPS = {
  // Soft sky gradients standing in for devin.ai's blurred photos (no images to license or load).
  sky: 'bg-[radial-gradient(120%_90%_at_20%_10%,#dbe8ff_0%,#eef3fb_45%,#e9ecef_100%)]',
  mist: 'bg-[radial-gradient(110%_80%_at_80%_0%,#e3ecf7_0%,#f1f3f6_50%,#e7e9ec_100%)]',
  dusk: 'bg-[radial-gradient(120%_90%_at_10%_100%,#d9e4f5_0%,#eceff5_55%,#e4e6ea_100%)]',
  none: '',
} as const

/**
 * Frame for a piece of real-looking product UI: an optional soft backdrop with the UI floating on it.
 * `bleed` lets the UI run past the right edge (the parent Section clips it), as devin.ai does on phones.
 */
export default function ProductShot({
  children,
  backdrop = 'sky',
  bleed,
  className,
  inner,
}: {
  children: ReactNode
  backdrop?: keyof typeof BACKDROPS
  bleed?: boolean
  className?: string
  /** Classes for the padding box around the UI. */
  inner?: string
}) {
  return (
    <div className={cn('relative overflow-hidden', backdrop !== 'none' && 'rounded-lg', BACKDROPS[backdrop], className)}>
      <div className={cn(backdrop !== 'none' && 'p-4 sm:p-8', bleed && 'pr-0 sm:pr-8 -mr-16 sm:mr-0', inner)}>{children}</div>
    </div>
  )
}

/** A white app-window card used inside shots (traffic-light dots optional). */
export function Window({ children, className, chrome = true, title }: { children: ReactNode; className?: string; chrome?: boolean; title?: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-black/[.08] bg-card shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)] overflow-hidden text-left', className)}>
      {chrome && (
        <div className="flex items-center gap-1.5 px-3 h-8 border-b border-hairline">
          <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
          <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
          <span className="w-2 h-2 rounded-full bg-[#28c840]" />
          {title && <span className="ml-3 text-[11px] text-muted-foreground truncate">{title}</span>}
        </div>
      )}
      {children}
    </div>
  )
}
