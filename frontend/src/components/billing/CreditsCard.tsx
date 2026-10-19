import { Link } from 'react-router-dom'
import { Gift } from 'lucide-react'
import { Button } from '../ui'
import type { CreditRow, CreditsView } from '../../api/client'

const KIND: Record<CreditRow['kind'], string> = {
  grant: 'Pro monthly usage',
  purchase: 'Credit pack',
  trial: 'Free trial',
  debit: 'Task',
  refund: 'Refund',
  adjust: 'Adjustment',
}

// Task debits are often fractions of a cent: show 3 decimals there instead of a misleading "$0.00".
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n) > 0 && Math.abs(n) < 0.01 ? Math.abs(n).toFixed(3) : Math.abs(n).toFixed(2)}`
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Credit balance (Pro's monthly usage, packs, the trial), what's held back by running tasks, the next
 * expiry, recent ledger rows, and the two ways to add credit.
 */
export default function CreditsCard({
  view,
  busy,
  onBuy,
  onTrial,
}: {
  view: CreditsView | null
  busy: string | null
  onBuy: () => void
  onTrial: () => void
}) {
  if (!view) return <p className="text-sm text-muted-foreground">Loading…</p>
  const { summary: s, history, trial, pack } = view
  const held = +(s.balanceUsd - s.availableUsd).toFixed(4)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Balance</p>
          <p className="mt-2 text-[32px] leading-none tracking-[-0.02em] tabular-nums">{usd(Math.max(0, s.balanceUsd))}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {held > 0.0001 ? `${usd(held)} held for running tasks · ` : ''}
            {s.nextExpiry ? `${usd(s.nextExpiry.usd)} expires ${day(s.nextExpiry.atIso)}` : s.balanceUsd > 0 ? 'No expiry soon' : 'Runs on our models, capped per task'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {trial.available && (
            <Button size="sm" variant="outline" className="rounded-md px-4" loading={busy === 'trial'} onClick={onTrial}>
              <Gift className="w-4 h-4" strokeWidth={1.75} /> Try 2 tasks free
            </Button>
          )}
          {pack.enabled ? (
            <Button size="sm" className="rounded-md px-4" data-track="buy_pack" data-track-where="settings" loading={busy === 'pack'} onClick={onBuy}>
              Buy {usd(pack.creditUsd)} credit — {usd(pack.priceUsd)}
            </Button>
          ) : (
            <Link to="/pricing" className="text-sm text-primary hover:underline self-center">See pricing</Link>
          )}
        </div>
      </div>

      {s.overdraftUsd > 0 && <p className="text-xs text-warning">A task went {usd(s.overdraftUsd)} over its cap; it's taken from your next credit.</p>}

      {history.length > 0 ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {history.slice(0, 8).map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate">
                {r.kind === 'debit' && r.taskId ? (
                  <Link to={`/tasks/${r.taskId}`} className="hover:underline underline-offset-2">{KIND[r.kind]}</Link>
                ) : (
                  KIND[r.kind]
                )}
                <span className="ml-2 text-xs text-muted-foreground">{day(r.createdAt)}</span>
              </span>
              <span className={`tabular-nums shrink-0 ${r.usd > 0 ? 'text-success' : 'text-muted-foreground'}`}>{r.usd > 0 ? '+' : ''}{usd(r.usd)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Credit runs tasks on our models when you don't have a key of your own: {usd(pack.priceUsd)} buys {usd(pack.creditUsd)} of usage, valid {Math.round(pack.validDays / 30)} months. No subscription.
        </p>
      )}
    </div>
  )
}
