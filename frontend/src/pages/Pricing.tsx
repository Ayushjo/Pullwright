import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Badge } from '../components/ui'
import { PullwrightIcon } from '../components/svgs/PullwrightMark'
import { useAuth } from '../context/AuthContext'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    blurb: 'Bring your own model key. You pay the model provider directly — usually a few cents per task.',
    cta: 'Start free',
    features: [
      '50 runs / month',
      'Your OpenAI or OpenRouter key (encrypted, never logged)',
      'Plan approval, live sandbox run, diff review',
      'Independent AI review + test validation on every run',
      'Draft pull requests on public and private repos',
    ],
  },
  {
    name: 'Pro',
    price: '$12',
    per: '/month',
    highlight: true,
    blurb: 'Model usage included — no key needed. Bring your own key any time to go past the allowance.',
    cta: 'Go Pro',
    features: [
      '100 runs / month',
      '$3 of model usage included (≈ 60–150 typical tasks)',
      'Auto-approve plans for routine issues',
      'Two tasks in parallel',
      'Everything in Free',
    ],
  },
]

const FAQ = [
  ['What does a task cost?', 'Our evals average $0.004–$0.04 per issue with gpt-5-mini, including planning, edits, tests and review. Every task has a hard spend cap and shows its exact cost.'],
  ['Is my code safe?', 'Each task runs in a throwaway sandbox with no network access after dependencies install, a read-only system, and no credentials inside. Your GitHub token only ever lives in the worker that opens the PR.'],
  ['Will it open junk PRs?', 'No PR is opened without your click. Before you see it, every change passes a validation gate (no empty or truncated files, no deleted tests, your tests and type-checks still pass) and an independent review against the issue’s requirements.'],
  ['Can I cancel?', 'Yes — manage or cancel your subscription any time from Settings. Payments are handled by Dodo Payments.'],
]

export default function Pricing() {
  const { user } = useAuth()
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

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <Badge tone="primary" dot>Pricing</Badge>
          <h1 className="text-3xl sm:text-4xl font-bold mt-4">Pay for reviewed pull requests, not tokens.</h1>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">Start free with your own key. Upgrade when you want model usage included.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-2xl border bg-card p-6 flex flex-col ${p.highlight ? 'border-primary shadow-[0_0_0_3px_rgba(43,127,255,0.12)]' : 'border-border'}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{p.name}</h2>
                {p.highlight && <Badge tone="primary">Most popular</Badge>}
              </div>
              <p className="mt-3">
                <span className="text-4xl font-bold">{p.price}</span>
                {p.per && <span className="text-muted-foreground">{p.per}</span>}
              </p>
              <p className="text-sm text-muted-foreground mt-2">{p.blurb}</p>
              <ul className="mt-5 space-y-2 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                to={user ? '/settings' : '/login?returnTo=/settings'}
                className={`mt-6 text-center text-sm font-semibold rounded-button px-4 py-2.5 ${p.highlight ? 'bg-primary text-primary-foreground hover:brightness-95' : 'border border-border hover:bg-muted'}`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="max-w-3xl mx-auto mt-14">
          <h2 className="text-xl font-bold mb-4">Questions</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="cursor-pointer text-sm font-semibold list-none flex justify-between">
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
