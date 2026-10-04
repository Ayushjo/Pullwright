import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Trash2, Undo2 } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * Remove with a grace period (adapted from useLayouts' Delete Button, MIT): the first click morphs the
 * button into "Undo · 5", counting down; only when it reaches zero is `onConfirm` called. Clicking again
 * cancels. Nothing is deleted by a stray click.
 */
export default function UndoDelete({ label = 'Remove', seconds = 5, onConfirm, className }: { label?: string; seconds?: number; onConfirm: () => void; className?: string }) {
  const [pending, setPending] = useState(false)
  const [count, setCount] = useState(seconds)
  const fired = useRef(false)

  useEffect(() => {
    if (!pending) return
    if (count === 0) {
      if (!fired.current) {
        fired.current = true
        onConfirm()
      }
      return
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [pending, count, onConfirm])

  const ease = [0.77, 0, 0.175, 1] as const
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {!pending ? (
        <motion.button
          key="remove"
          layoutId="undo-delete"
          type="button"
          onClick={() => {
            fired.current = false
            setCount(seconds)
            setPending(true)
          }}
          whileTap={{ scale: 0.95 }}
          transition={{ layout: { duration: 0.35, ease } }}
          className={cn('inline-flex items-center gap-1.5 rounded-button px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors focus-ring', className)}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {label}
        </motion.button>
      ) : (
        <motion.button
          key="undo"
          layoutId="undo-delete"
          type="button"
          onClick={() => setPending(false)}
          whileTap={{ scale: 0.95 }}
          initial={{ backgroundColor: '#fee2e2' }}
          animate={{ backgroundColor: '#fff1f2' }}
          transition={{ layout: { duration: 0.35, ease } }}
          className={cn('inline-flex items-center gap-1.5 rounded-button px-2.5 py-1.5 text-xs font-medium text-red-700 focus-ring', className)}
          aria-live="polite"
        >
          <Undo2 className="w-3.5 h-3.5" />
          Undo
          <span className="relative inline-flex w-3 justify-center tabular-nums overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={count} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ duration: 0.2 }}>
                {count}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
