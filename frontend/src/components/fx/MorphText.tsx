import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

/**
 * Text that morphs letter by letter when it changes (adapted from useLayouts' Save Button, MIT).
 * Each character springs in with a slight blur; unchanged positions keep their layout.
 */
export default function MorphText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion()
  if (reduce) return <span className={className}>{text}</span>
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden className="inline-flex">
        <AnimatePresence mode="popLayout" initial={false}>
          {text.split('').map((char, i) => (
            <motion.span
              key={`${char}-${i}`}
              layout
              initial={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
              className="inline-block whitespace-pre"
            >
              {char}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </span>
  )
}
