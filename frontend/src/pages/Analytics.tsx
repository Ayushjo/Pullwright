import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import AppShell from '../components/AppShell'
import { PageHeader } from '../components/ui'
import { getAnalytics, type AnalyticsReport } from '../api/client'
import { useSeo } from '../lib/seo'
import { cn } from '../lib/cn'

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString())
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')

function Card({ title, children, className, aside }: { title: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-hairline bg-card overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-hairline">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** One measure per chart (small multiples, never two scales on one axis): thin bars, hover for the value. */
function DailyBars({ label, series }: { label: string; series: { day: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...series.map((s) => s.value))
  const total = series.reduce((a, s) => a + s.value, 0)
  const h = hover !== null ? series[hover] : null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{h ? `${day(h.day)} · ${fmt(h.value)}` : `${fmt(total)} total`}</p>
      </div>
      <div className="mt-3 flex h-24 items-end gap-[2px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`${label} per day, ${fmt(total)} in total`}>
        {series.map((s, i) => (
          <div key={s.day} className="group relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <motion.div
              className={cn('w-full rounded-t-[3px]', s.value ? 'bg-primary' : 'bg-black/[.06]', hover !== null && hover !== i && 'opacity-50')}
              initial={{ height: 0 }}
              animate={{ height: s.value ? `${Math.max(4, (s.value / max) * 100)}%` : '2px' }}
              transition={{ duration: 0.5, delay: i * 0.005 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{series[0] && day(series[0].day)}</span>
        <span>{series.at(-1) && day(series.at(-1)!.day)}</span>
      </div>
    </div>
  )
}

/** Rows with an inline bar (share of the top row) and right-aligned numbers. */
function BarTable({ rows, cols }: { rows: { label: string; value: number; extra?: string }[]; cols: [string, string, string?] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data yet.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          <th className="pb-2 font-normal">{cols[0]}</th>
          <th className="pb-2 font-normal text-right">{cols[1]}</th>
          {cols[2] && <th className="pb-2 pl-4 font-normal text-right">{cols[2]}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-hairline">
            <td className="py-2 pr-3">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 rounded-sm bg-primary/10" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
                <span className="relative block truncate px-1.5 py-0.5">{r.label}</span>
              </div>
            </td>
            <td className="py-2 text-right tabular-nums">{fmt(r.value)}</td>
            {cols[2] && <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{r.extra}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const RANGES = [7, 30, 90]

export default function Analytics() {
  useSeo({ title: 'Analytics', description: 'Pullwright product analytics.', noindex: true })
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AnalyticsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    getAnalytics(days).then(setData).catch((e: Error) => setError(e.message))
  }, [days])

  const t = data?.totals
  const kpis = t
    ? [
        ['Visitors', t.visitors, `${fmt(t.pageViews)} page views`],
        ['Signups', t.signups, `${pct(t.signups, t.visitors)} of visitors`],
        ['Active users', t.activeUsers, 'did anything signed in'],
        ['Tasks', t.tasksCreated, `${fmt(t.prsPublished)} PRs published`],
        ['Purchases', t.purchases, 'packs and Pro starts'],
      ]
    : []
  const funnelTop = data?.funnel[0]?.count ?? 0

  return (
    <AppShell>
      <PageHeader
        title="Analytics"
        description="First-party product analytics: visits, signups, activation and where people come from. No IP addresses stored; visitors who send Do Not Track aren't tracked."
        action={
          <div className="inline-flex rounded-pill border border-hairline bg-card p-0.5" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setDays(r)} className={cn('rounded-pill px-3 py-1 text-xs transition-colors', days === r ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
                {r} days
              </button>
            ))}
          </div>
        }
      />
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline lg:grid-cols-5">
            {kpis.map(([label, value, note]) => (
              // Five tiles: on two columns the last one spans the row, so no empty grey cell is left.
              <div key={label as string} className="bg-card px-5 py-4 last:col-span-2 lg:last:col-span-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
                <p className="mt-2 text-[28px] leading-none tracking-[-0.02em] tabular-nums">{fmt(value as number)}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>

          <Card title={`Daily · last ${days} days`}>
            <div className="grid gap-8 md:grid-cols-3">
              <DailyBars label="Visitors" series={data.daily.map((d) => ({ day: d.day, value: d.visitors }))} />
              <DailyBars label="Signups" series={data.daily.map((d) => ({ day: d.day, value: d.signups }))} />
              <DailyBars label="Tasks started" series={data.daily.map((d) => ({ day: d.day, value: d.tasks }))} />
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <Card title="Activation funnel">
              <ol className="space-y-3">
                {data.funnel.map((s, i) => {
                  const prev = i > 0 ? data.funnel[i - 1]!.count : s.count
                  return (
                    <li key={s.stage}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-foreground">{s.stage}</span>
                        <span className="tabular-nums text-foreground">
                          {fmt(s.count)}
                          {i > 0 && <span className="ml-2 text-xs text-muted-foreground">{pct(s.count, prev)} of previous</span>}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-black/[.05]">
                        <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${funnelTop ? Math.max(s.count ? 2 : 0, (s.count / funnelTop) * 100) : 0}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} />
                      </div>
                    </li>
                  )
                })}
              </ol>
              <p className="mt-4 text-xs text-muted-foreground">Distinct people at each step in the period. Visitors are counted by browser; the later steps by account.</p>
            </Card>

            <Card title="Where people come from">
              <BarTable rows={data.sources.map((s) => ({ label: s.source, value: s.sessions, extra: fmt(s.signups) }))} cols={['Source', 'Sessions', 'Signed in']} />
            </Card>

            <Card title="Top pages">
              <BarTable rows={data.pages.map((p) => ({ label: p.path, value: p.views, extra: fmt(p.visitors) }))} cols={['Page', 'Views', 'Visitors']} />
            </Card>

            <div className="grid gap-5 sm:grid-cols-2">
              <Card title="Devices">
                <BarTable rows={data.devices.map((d) => ({ label: d.device, value: d.visitors }))} cols={['Device', 'Visitors']} />
              </Card>
              <Card title="Countries">
                <BarTable rows={data.countries.map((c) => ({ label: c.country, value: c.visitors }))} cols={['Country', 'Visitors']} />
              </Card>
            </div>

            <Card title="Refusals (402 / 429)">
              <BarTable rows={data.refusals.map((r) => ({ label: r.code, value: r.count }))} cols={['Reason', 'Times']} />
              <p className="mt-3 text-xs text-muted-foreground">When someone tried to start a task and couldn't: no key or credit, daily or concurrency limits, free tasks used up.</p>
            </Card>

            <Card title="Recent signups" className="lg:col-span-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      <th className="pb-2 font-normal">Account</th>
                      <th className="pb-2 font-normal">Signed up</th>
                      <th className="pb-2 font-normal">First came from</th>
                      <th className="pb-2 font-normal text-right">Tasks</th>
                      <th className="pb-2 font-normal text-right">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSignups.map((u) => {
                      const ft = (u.firstTouch ?? null) as { referrer?: string | null; landing?: string | null; utm?: { source?: string | null; campaign?: string | null } } | null
                      const from = ft ? (ft.utm?.source ? `${ft.utm.source}${ft.utm.campaign ? ` · ${ft.utm.campaign}` : ''}` : ft.referrer ?? 'direct') : '—'
                      return (
                        <tr key={u.login} className="border-t border-hairline">
                          <td className="py-2">@{u.login}</td>
                          <td className="py-2 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                          <td className="py-2">
                            {from}
                            {ft?.landing && <span className="ml-1.5 text-xs text-muted-foreground">→ {ft.landing}</span>}
                          </td>
                          <td className="py-2 text-right tabular-nums">{u.tasks}</td>
                          <td className="py-2 text-right text-muted-foreground">{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  )
}
