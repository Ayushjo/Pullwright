import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, BellRing, CheckCircle2, Sparkles } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Badge, PageHeader } from '../components/ui'
import { getPoolAdmin, type PoolAdmin, type PoolAlert } from '../api/client'
import { cn } from '../lib/cn'

const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(0)}`
const level = (pct: number) => (pct >= 0.9 ? 'critical' : pct >= 0.7 ? 'warn' : 'ok')
const bar = { ok: 'bg-primary', warn: 'bg-amber-500', critical: 'bg-red-500' } as const

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-hairline bg-card overflow-hidden', className)}>
      <h2 className="px-5 py-3.5 border-b border-hairline font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** A spend bar with the alert thresholds marked on it. */
function Meter({ spent, budget, marks = [] }: { spent: number; budget: number; marks?: number[] }) {
  const pct = budget > 0 ? spent / budget : 0
  return (
    <div className="relative mt-4 h-2 rounded-full bg-black/[.07]">
      <motion.div
        className={cn('h-full rounded-full', bar[level(pct)])}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, pct * 100)}%` }}
        transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
      />
      {marks.map((m) => (
        <span key={m} className="absolute -top-1 h-4 w-px bg-foreground/30" style={{ left: `${m * 100}%` }} aria-hidden>
          <span className="absolute top-5 -translate-x-1/2 font-mono text-[10px] text-muted-foreground">{Math.round(m * 100)}%</span>
        </span>
      ))}
    </div>
  )
}

function AlertRow({ a }: { a: PoolAlert }) {
  const crit = a.level === 'critical'
  return (
    <li className="flex items-start gap-3 py-3">
      <AlertTriangle className={cn('w-4 h-4 mt-0.5 shrink-0', crit ? 'text-red-600' : 'text-amber-600')} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{a.message}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{new Date(a.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <Badge tone={crit ? 'danger' : 'warning'}>{a.scope === 'day' ? 'Today full' : `${Math.round(a.pct * 100)}%`}</Badge>
    </li>
  )
}

export default function Pool() {
  const [data, setData] = useState<PoolAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const load = () => getPoolAdmin().then(setData).catch((e: Error) => setError(e.message))
    void load()
    const t = setInterval(load, 30_000) // live enough to watch a busy day
    return () => clearInterval(t)
  }, [])

  const p = data?.pool
  const monthPct = p ? p.spentMonthUsd / p.monthlyUsd : 0
  const projPct = p ? p.projectedMonthUsd / p.monthlyUsd : 0

  return (
    <AppShell>
      <PageHeader title="Free pool" description="Spend on the free Claude tasks, paid from the promo credits. Alerts fire at 70% and 90% of the month, and when a day fills up." />
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !p ? (
        <Card title="Not configured">
          <p className="text-sm text-muted-foreground">Set ANTHROPIC_POOL_MONTHLY_USD (and ANTHROPIC_POOL_DAILY_USD) in the backend to turn the free pool on.</p>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
          <Card title="This month" className="lg:col-span-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[34px] leading-none tracking-[-0.02em] tabular-nums">
                  {usd(p.spentMonthUsd)} <span className="text-base text-muted-foreground">of {usd(p.monthlyUsd)}</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{Math.round(monthPct * 100)}% used · resets on the 1st (UTC)</p>
              </div>
              <Badge tone={level(monthPct) === 'ok' ? 'neutral' : level(monthPct) === 'warn' ? 'warning' : 'danger'} dot>
                {level(monthPct) === 'ok' ? 'On budget' : level(monthPct) === 'warn' ? 'Past 70%' : 'Past 90%'}
              </Badge>
            </div>
            <Meter spent={p.spentMonthUsd} budget={p.monthlyUsd} marks={p.thresholds.filter((t) => t < 1)} />
            <p className={cn('mt-8 text-sm', projPct >= 0.9 ? 'text-red-700' : projPct >= 0.7 ? 'text-amber-800' : 'text-muted-foreground')}>
              On pace for <span className="tabular-nums font-medium text-foreground">{usd(p.projectedMonthUsd)}</span> by month-end ({Math.round(projPct * 100)}% of budget).
            </p>
          </Card>

          <Card title="Today">
            <p className="text-[34px] leading-none tracking-[-0.02em] tabular-nums">
              {usd(p.spentDayUsd)} {p.dailyUsd !== null && <span className="text-base text-muted-foreground">of {usd(p.dailyUsd)}</span>}
            </p>
            {p.dailyUsd !== null && <Meter spent={p.spentDayUsd} budget={p.dailyUsd} />}
            <p className="mt-8 text-xs text-muted-foreground">When today fills up, free tasks pause until 00:00 UTC; running ones resume then.</p>
          </Card>

          <Card title="Free tasks this month">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" strokeWidth={1.75} />
              <p className="text-[26px] leading-none tabular-nums">{data.usage.freeTasks}</p>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Users</dt>
                <dd className="mt-1 tabular-nums">{data.usage.freeUsers}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Avg per task</dt>
                <dd className="mt-1 tabular-nums">{data.usage.avgCostUsd !== null ? `$${data.usage.avgCostUsd.toFixed(4)}` : '—'}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Allowance</dt>
                <dd className="mt-1">{data.allowance.tasksPerMonth} / user / month</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Model</dt>
                <dd className="mt-1">{p.model.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase())}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Alerts" className="lg:col-span-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <BellRing className="w-3.5 h-3.5" strokeWidth={1.75} />
              {data.webhook ? 'Also sent to your Slack/Discord webhook.' : 'Shown here and in the server log. Set POOL_ALERT_WEBHOOK_URL to get them in Slack or Discord.'}
            </p>
            {data.alerts.length ? (
              <ul className="divide-y divide-hairline">{data.alerts.map((a, i) => <AlertRow key={i} a={a} />)}</ul>
            ) : (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-success" strokeWidth={1.75} /> No alerts this month.
              </p>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  )
}
