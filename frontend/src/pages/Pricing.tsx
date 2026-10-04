import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import { Badge } from '../components/ui'
import { PullwrightIcon } from '../components/svgs/PullwrightMark'
import { HandCircle, HandUnderline } from '../components/hand/Scribbles'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/cn'

type WayId = 'free' | 'keys' | 'pro'

// Limits mirror backend/src/entitlements/admission.ts (free 3/day, 1 at a time; Pro 25/day, 3 at a time)
// and the Pro plan in docs (hosted credit $3/month).
const WAYS: {
  id: WayId
  name: string
  who: string
  price: string
  per?: string
  blurb: string
  features: string[]
  cta: { label: string; to: string }
}[] = [
  {
    id: 'free',
    name: 'Free keys',
    who: 'Most people start here',
    price: '$0',
    blurb: 'Paste a free Google Gemini key (a minute, no card). Add Groq, Vercel or OpenRouter free keys to make it faster and sharper.',
    features: [
      '3 tasks a day, one at a time',
      'Planning, sandboxed run, tests and an independent review on every task',
      'Pauses when a free quota runs out and picks up when it resets — nothing lost',
      'Private repos only go to providers that don’t train on your code',
    ],
    cta: { label: 'Add a free key', to: '/wallet' },
  },
  {
    id: 'keys',
    name: 'Your paid keys',
    who: 'You already pay OpenAI or OpenRouter',
    price: 'Provider rates',
    blurb: 'Add your own paid key alongside the free ones. Free keys are always used first; your key only covers what they can’t.',
    features: [
      'Same 3 tasks a day on the free plan',
      'You pay your provider directly — a typical task is a few cents',
      'Keys are checked on save, stored encrypted, never shown again',
      'Remove a key any time',
    ],
    cta: { label: 'Add a key', to: '/wallet' },
  },
  {
    id: 'pro',
    name: 'Pro',
    who: 'No keys to manage',
    price: '$8',
    per: '/month',
    blurb: 'Runs on our models with $3 of model usage included every month. Your free keys still go first, so the credit lasts longer.',
    features: [
      '25 tasks a day, three at once',
      'Priority queue — never waits behind free tasks',
      '$3 of model usage each month (≈35 hard tasks)',
      'Everything in Free keys',
    ],
    cta: { label: 'Go Pro', to: '/settings' },
  },
]

const FAQ = [
  [
    'Is the free way really free?',
    'Yes. Google, Groq, Vercel and OpenRouter all offer free API keys without a card. Pullwright only uses the free tiers of those keys, and never charges you on the free plan.',
  ],
  [
    'What happens when a free quota runs out mid-task?',
    'The task pauses and shows when it will continue — usually at the provider’s daily reset. It resumes on its own from where it stopped, or you can add another key to continue now.',
  ],
  [
    'Is my code safe?',
    'Each task runs in a throwaway sandbox with no network access after dependencies install and no credentials inside. Your GitHub token only lives in the worker that opens the PR, and no PR is opened without your click.',
  ],
  ['Can I cancel Pro?', 'Yes — manage or cancel any time from Settings. Payments are handled by Dodo Payments.'],
]

const spring = { type: 'spring' as const, stiffness: 320, damping: 30, mass: 0.8 }

export default function Pricing() {
  const { user } = useAuth()
  const [selected, setSelected] = useState<WayId>('free')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-sm">
            <PullwrightIcon className="w-6 h-6" /> Pullwright
          </Link>
          <Link to={user ? '/dashboard' : '/login'} className="text-sm font-medium text-primary hover:underline">
            {user ? 'Dashboard' : 'Sign in'} →
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 sm:py-14">
        <div className="text-center mb-10">
          <Badge tone="primary" dot>
            Pricing
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold mt-4 tracking-tight">
            Three ways to use it.{' '}
            <span className="relative inline-block whitespace-nowrap">
              One is free.
              <HandUnderline className="text-primary/70 -bottom-2 h-3" strokeWidth={3.5} delay={0.4} duration={0.8} />
            </span>
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Every way gets the same agent: a plan you approve, a sandboxed run, tests, an independent review, and a PR only when you say so.</p>
        </div>

        <LayoutGroup>
          <div className="max-w-xl mx-auto flex flex-col gap-3" role="radiogroup" aria-label="Ways to use Pullwright">
            {WAYS.map((w) => {
              const on = selected === w.id
              return (
                <motion.div
                  key={w.id}
                  layout
                  transition={spring}
                  role="radio"
                  aria-checked={on}
                  tabIndex={0}
                  onClick={() => setSelected(w.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelected(w.id)
                    }
                  }}
                  className={cn(
                    'relative cursor-pointer rounded-2xl border bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    on ? 'border-primary shadow-[0_0_0_3px_rgba(43,127,255,0.12)]' : 'border-border hover:border-neutral-300',
                  )}
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-3.5">
                      <span className={cn('mt-1 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors duration-300', on ? 'border-primary' : 'border-neutral-300')}>
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              exit={{ scale: 0 }}
                              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                              className="w-2.5 h-2.5 rounded-full bg-primary"
                            />
                          )}
                        </AnimatePresence>
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="text-base font-semibold leading-tight">{w.name}</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">{w.who}</p>
                          </div>
                          <div className="text-right shrink-0">
                            {w.id === 'free' ? (
                              <span className="relative inline-block px-1.5 text-2xl font-bold">
                                {w.price}
                                <HandCircle className="text-primary/70" delay={0.6} />
                              </span>
                            ) : (
                              <span className={cn('font-bold', w.per ? 'text-2xl' : 'text-sm text-muted-foreground')}>{w.price}</span>
                            )}
                            {w.per && <span className="text-sm text-muted-foreground">{w.per}</span>}
                          </div>
                        </div>

                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.div
                              key="details"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ height: spring, opacity: { duration: 0.2 } }}
                              className="overflow-hidden"
                            >
                              <p className="text-sm text-muted-foreground mt-3">{w.blurb}</p>
                              <ul className="mt-3 space-y-2">
                                {w.features.map((f, i) => (
                                  <motion.li
                                    key={f}
                                    initial={{ opacity: 0, x: -4 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.08 + i * 0.05 }}
                                    className="flex gap-2 text-sm"
                                  >
                                    <Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> {f}
                                  </motion.li>
                                ))}
                              </ul>
                              <Link
                                to={user ? w.cta.to : `/login?returnTo=${encodeURIComponent(w.cta.to)}`}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-4 inline-flex w-full sm:w-auto items-center justify-center gap-2 text-sm font-semibold rounded-button px-4 py-2.5 bg-primary text-primary-foreground hover:brightness-95"
                              >
                                {w.cta.label}
                                <ArrowRight className="w-4 h-4" />
                              </Link>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </LayoutGroup>

        <div className="max-w-xl mx-auto mt-14">
          <h2 className="text-xl font-bold mb-4">Questions</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="cursor-pointer text-sm font-semibold list-none flex justify-between gap-4">
                  {q} <span className="text-muted-foreground group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
