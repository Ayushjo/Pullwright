import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { getPoolAdmin, type PoolAdmin } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { cn } from '../../lib/cn'

/** Owner-only: a banner on the dashboard once the free pool passes 70% of the month or fills up today. */
export default function PoolBanner() {
  const { user } = useAuth()
  const [d, setD] = useState<PoolAdmin | null>(null)
  useEffect(() => {
    if (user?.isOwner) getPoolAdmin().then(setD).catch(() => setD(null))
  }, [user?.isOwner])
  const p = d?.pool
  if (!p) return null
  const pct = p.spentMonthUsd / p.monthlyUsd
  const dayFull = p.dailyUsd !== null && p.spentDayUsd + (d.allowance.taskCapUsd ?? 0) > p.dailyUsd
  if (pct < 0.7 && !dayFull) return null
  const crit = pct >= 0.9
  const $ = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(0)}`
  const text = pct >= 0.7
    ? `The free Claude pool has used ${Math.round(pct * 100)}% of this month's ${$(p.monthlyUsd)} — on pace for ${$(p.projectedMonthUsd)}.`
    : `Today's free Claude pool is full; free tasks resume at 00:00 UTC.`
  return (
    <div className={cn('mb-6 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3', crit ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/70')} role="alert">
      <AlertTriangle className={cn('w-4 h-4 shrink-0', crit ? 'text-red-600' : 'text-amber-600')} strokeWidth={1.75} />
      <p className={cn('flex-1 text-sm', crit ? 'text-red-900' : 'text-amber-900')}>{text}</p>
      <Link to="/admin/pool" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2">
        Open pool <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  )
}
