import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import type { FreeAllowance } from '../../api/client'
import { cn } from '../../lib/cn'

const date = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The free monthly Claude allowance as one line: what's left, when it renews, and why it's paused if it is. */
/** "claude-haiku-5-5" → "Haiku 5.5". */
export const modelLabel = (id: string) =>
  id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase())

export function freeClaudeText(f: FreeAllowance): { line: string; note: string | null; blocked: boolean } {
  if (f.ineligible) return { line: 'Free Claude tasks', note: f.ineligible, blocked: true }
  if (f.left <= 0) return { line: f.limit === 1 ? 'Your free Claude task is used this month' : `All ${f.limit} free Claude tasks used this month`, note: `They renew ${date(f.renewsAt)}. A free Gemini key gives you unlimited free tasks.`, blocked: true }
  if (!f.poolOpen)
    return { line: `${f.left} of ${f.limit} free Claude tasks left this month`, note: `Today's free tasks are all taken — back ${f.poolOpensAt ? `at ${time(f.poolOpensAt)}` : 'tomorrow'}.`, blocked: true }
  return { line: `${f.left} of ${f.limit} free Claude tasks left this month`, note: `No key needed · renews ${date(f.renewsAt)}`, blocked: false }
}

export default function FreeClaudeMeter({ free, className, showKeyHint = true }: { free: FreeAllowance | null | undefined; className?: string; showKeyHint?: boolean }) {
  if (!free?.enabled) return null
  const { line, note, blocked } = freeClaudeText(free)
  const pct = free.limit ? Math.min(100, (free.left / free.limit) * 100) : 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-md border px-3 py-2.5', blocked ? 'border-amber-200 bg-amber-50/60' : 'border-hairline bg-card', className)}
      role="status"
    >
      <div className="flex items-center gap-2 text-[13px]">
        <Sparkles className={cn('w-4 h-4 shrink-0', blocked ? 'text-amber-700' : 'text-primary')} strokeWidth={1.75} />
        <span className={blocked ? 'text-amber-900' : 'text-foreground'}>{line}</span>
      </div>
      {!free.ineligible && (
        <div className="mt-2 h-1 rounded-full bg-black/[.07] overflow-hidden" aria-hidden>
          <motion.div className="h-full bg-primary rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }} />
        </div>
      )}
      {note && <p className={cn('mt-1.5 text-xs', blocked ? 'text-amber-800' : 'text-muted-foreground')}>{note}</p>}
      {blocked && showKeyHint && (
        <Link to="/wallet" className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline underline-offset-2">
          Add a free Gemini key →
        </Link>
      )}
    </motion.div>
  )
}
