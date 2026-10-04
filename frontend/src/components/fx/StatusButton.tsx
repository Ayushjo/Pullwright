import { AnimatePresence, motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import MorphText from './MorphText'

export type ButtonStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * A button whose label morphs through idle → loading → success (adapted from useLayouts' Save Button,
 * MIT): the label changes letter by letter and a small badge in the corner shows a spinner, then a tick.
 */
export default function StatusButton({
  status,
  labels,
  onClick,
  disabled,
  className,
  type = 'button',
}: {
  status: ButtonStatus
  labels: { idle: string; loading: string; success: string; error?: string }
  onClick?: () => void
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  const text = status === 'error' ? (labels.error ?? labels.idle) : labels[status]
  const busy = status === 'loading' || status === 'success'
  return (
    <span className="relative inline-flex">
      <button
        type={type}
        onClick={onClick}
        disabled={disabled || busy}
        className={cn(
          'relative inline-flex items-center justify-center rounded-button text-sm font-medium px-4 py-2 min-w-[118px] transition-colors duration-300 focus-ring',
          busy ? 'bg-muted text-muted-foreground cursor-default' : 'bg-primary text-primary-foreground hover:brightness-95',
          status === 'error' && 'bg-destructive text-destructive-foreground',
          'disabled:cursor-not-allowed',
          disabled && !busy && 'opacity-50',
          className,
        )}
      >
        <MorphText text={text} />
      </button>
      <span className="absolute -top-1.5 -right-1.5 z-10 pointer-events-none">
        <AnimatePresence mode="wait">
          {status !== 'idle' && (
            <motion.span
              key={status === 'error' ? 'err' : 'badge'}
              initial={{ opacity: 0, scale: 0, x: -8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0, x: -8, filter: 'blur(4px)' }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className={cn(
                'relative flex items-center justify-center w-5 h-5 rounded-full ring-2 ring-background',
                status === 'success' ? 'bg-primary text-primary-foreground' : status === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {status === 'loading' && (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="currentColor" opacity=".45" d="M12 2A10 10 0 1 0 22 12A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8A8 8 0 0 1 12 20Z" />
                  <path fill="currentColor" d="M20 12h2A10 10 0 0 0 12 2V4A8 8 0 0 1 20 12Z">
                    <animateTransform attributeName="transform" dur="0.9s" from="0 12 12" repeatCount="indefinite" to="360 12 12" type="rotate" />
                  </path>
                </svg>
              )}
              {status === 'success' && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
                  <Check className="w-3 h-3" strokeWidth={3} />
                </motion.span>
              )}
              {status === 'error' && <X className="w-3 h-3" strokeWidth={3} />}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </span>
  )
}
