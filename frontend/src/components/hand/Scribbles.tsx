import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * Hand-drawn accents (paths drawn freehand, slightly uneven on purpose). They draw themselves in once
 * when they appear; with reduced motion they're simply shown. Color comes from `currentColor`.
 */

type DrawProps = { className?: string; delay?: number; duration?: number; strokeWidth?: number }

function useDraw(delay = 0, duration = 0.7) {
  const reduce = useReducedMotion()
  return reduce
    ? { initial: false as const, animate: { pathLength: 1, opacity: 1 } }
    : {
        initial: { pathLength: 0, opacity: 0 },
        animate: { pathLength: 1, opacity: 1 },
        transition: { pathLength: { delay, duration, ease: [0.65, 0, 0.35, 1] as const }, opacity: { delay, duration: 0.01 } },
      }
}

/** A loose marker underline, stretched to the width of its container. */
export function HandUnderline({ className, delay, duration, strokeWidth = 3 }: DrawProps) {
  const draw = useDraw(delay, duration)
  return (
    <svg aria-hidden viewBox="0 0 200 12" preserveAspectRatio="none" className={cn('pointer-events-none absolute left-0 -bottom-1.5 w-full h-2.5', className)}>
      <motion.path d="M2 8.5 C 40 4.5, 85 3.2, 120 4.6 S 178 7.8, 198 3.6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...draw} />
    </svg>
  )
}

/** A curly arrow pointing down-left (place it next to what it points at). */
export function HandArrow({ className, delay, duration = 0.9, strokeWidth = 2 }: DrawProps) {
  const draw = useDraw(delay, duration)
  const head = useDraw((delay ?? 0) + duration * 0.85, 0.25)
  return (
    <svg aria-hidden viewBox="0 0 90 70" className={cn('pointer-events-none w-20 h-16', className)}>
      <motion.path d="M84 6 C 70 8, 52 14, 46 28 C 40 42, 58 46, 56 34 C 54 22, 30 30, 22 44 C 17 52, 15 58, 14 63" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...draw} />
      <motion.path d="M6 54 L 14 64 L 24 56" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...head} />
    </svg>
  )
}

/** A hand-drawn loop around inline content. Wrap the content in a relative inline-block. */
export function HandCircle({ className, delay, duration = 0.9, strokeWidth = 2 }: DrawProps) {
  const draw = useDraw(delay, duration)
  return (
    <svg aria-hidden viewBox="0 0 120 50" preserveAspectRatio="none" className={cn('pointer-events-none absolute -inset-x-2 -inset-y-1.5 w-[calc(100%+1rem)] h-[calc(100%+0.75rem)]', className)}>
      <motion.path d="M70 4 C 30 2, 4 10, 5 26 C 6 42, 40 47, 74 45 C 104 43, 117 33, 115 21 C 113 9, 92 4, 60 6 C 50 7, 44 9, 40 11" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...draw} />
    </svg>
  )
}

/** A quick hand-drawn tick. */
export function HandCheck({ className, delay, duration = 0.45, strokeWidth = 2.5 }: DrawProps) {
  const draw = useDraw(delay, duration)
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn('w-4 h-4', className)}>
      <motion.path d="M4.5 12.8 C 6.4 14.2, 8 16, 9.4 18.2 C 12.2 12.6, 15.6 8.4, 20 4.6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...draw} />
    </svg>
  )
}

/** A doodled key (empty wallet illustration). */
export function HandKey({ className, delay = 0, strokeWidth = 2 }: DrawProps) {
  const ring = useDraw(delay, 0.7)
  const shaft = useDraw(delay + 0.55, 0.5)
  const teeth = useDraw(delay + 0.95, 0.35)
  const sparkle = useDraw(delay + 1.2, 0.3)
  return (
    <svg aria-hidden viewBox="0 0 120 80" className={cn('w-28 h-20', className)}>
      <motion.path d="M38 22 C 24 20, 14 30, 16 42 C 18 55, 34 60, 44 52 C 54 44, 52 26, 38 22 Z" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...ring} />
      <motion.path d="M30 38 C 31 34, 36 33, 38 37" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...ring} />
      <motion.path d="M51 40 C 70 40, 88 39.5, 104 40.5" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...shaft} />
      <motion.path d="M92 40.5 L 92.5 51 M 101 41 L 100.5 48" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...teeth} />
      <motion.path d="M96 14 L 96 24 M 91 19 L 101 19 M 108 26 L 108 31 M 105.5 28.5 L 110.5 28.5" fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.8} strokeLinecap="round" {...sparkle} />
    </svg>
  )
}
