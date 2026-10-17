import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Badge, Button, PageHeader, useToast } from '../components/ui'
import CapacityMeter from '../components/wallet/CapacityMeter'
import CreditsCard from '../components/billing/CreditsCard'
import FreeClaudeMeter, { modelLabel } from '../components/billing/FreeClaudeMeter'
import { claimTrial, getBilling, getCredits, getWallet, openBillingPortal, startCheckout, syncBilling, type BillingInfo, type CreditsView, type WalletView } from '../api/client'
import { useSeo } from '../lib/seo'

/** White card with a mono title over a hairline. */
function Section({ title, id, className = '', children }: { title: string; id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`rounded-lg border border-hairline bg-card overflow-hidden scroll-mt-24 ${className}`}>
      <h2 className="px-5 py-3.5 border-b border-hairline font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function Settings() {
  useSeo({ title: 'Settings', description: 'Pullwright — your tasks, keys and plan.', noindex: true })
  const { push } = useToast()
  const [info, setInfo] = useState<BillingInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<WalletView | null>(null)
  const [credits, setCredits] = useState<CreditsView | null>(null)
  // Same guard as billing: on the return from checkout an older response must not overwrite the newer one.
  const creditsSeq = useRef(0)
  const loadCredits = () => {
    const seq = ++creditsSeq.current
    return getCredits()
      .then((c) => seq === creditsSeq.current && setCredits(c))
      .catch(() => seq === creditsSeq.current && setCredits(null))
  }
  const [busy, setBusy] = useState<string | null>(null)
  // Only the newest billing response is shown: the first load can resolve after the post-checkout refresh.
  const billingSeq = useRef(0)
  const loadBilling = async () => {
    const seq = ++billingSeq.current
    const b = await getBilling()
    if (seq === billingSeq.current) setInfo(b)
  }

  useEffect(() => {
    loadBilling().catch((e: Error) => setError(e.message))
    void loadCredits()
    getWallet()
      .then(setWallet)
      .catch(() => setWallet(null))
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') !== 'success') return
    // Back from checkout: confirm with Dodo now (a few tries while the payment settles), then drop the flag.
    window.history.replaceState(null, '', window.location.pathname)
    let stop = false
    void (async () => {
      for (let i = 0; i < 8 && !stop; i++) {
        const r = await syncBilling().catch(() => ({ status: 'error' }))
        if (r.status === 'active') {
          if (!stop) {
            await loadBilling()
            push('Welcome to Pro — your plan is active.', 'success')
          }
          return
        }
        // A credit pack: "credited" when this call added it, "succeeded" when the webhook already had.
        if (r.status === 'credited' || r.status === 'succeeded') {
          if (!stop) {
            await Promise.all([loadBilling(), loadCredits()])
            push('Credits added to your balance.', 'success')
          }
          return
        }
        if (['failed', 'cancelled', 'expired', 'none'].includes(r.status)) break
        await new Promise((res) => setTimeout(res, 2500))
      }
      if (!stop) push('Payment received — it shows up here as soon as it is confirmed.', 'info')
    })()
    return () => {
      stop = true
    }
  }, [push])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      push((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const ent = info?.entitlement
  const pro = ent?.tier === 'pro'

  return (
    <AppShell>
      <PageHeader title="Settings" description="Your plan, usage and model keys." />
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Section title="Plan & usage">
          {!ent ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone={pro ? 'primary' : 'neutral'} dot>{pro ? 'Pro' : 'Free'}</Badge>
                  {info?.subscription?.cancelAtPeriodEnd && <span className="text-xs text-warning">Cancels at period end</span>}
                </div>
                {pro ? (
                  <Button size="sm" variant="outline" shape="pill" className="px-4" loading={busy === 'portal'} onClick={() => run('portal', async () => void (window.location.href = (await openBillingPortal()).url))}>
                    Manage billing
                  </Button>
                ) : info?.paymentsEnabled ? (
                  <Button size="sm" shape="pill" className="px-4" data-track="upgrade_pro" data-track-where="settings" loading={busy === 'checkout'} onClick={() => run('checkout', async () => void (window.location.href = (await startCheckout()).url))}>
                    Upgrade to Pro — $8/mo
                  </Button>
                ) : (
                  <Link to="/pricing" className="text-sm text-primary hover:underline">See plans</Link>
                )}
              </div>
              <CapacityMeter className="w-fit max-w-full" />
              <FreeClaudeMeter free={ent.free} className="sm:max-w-sm" />
              {pro && (
                <div className="rounded-md border border-hairline p-4 sm:max-w-xs">
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Included usage this month</p>
                  <p className="mt-2 text-[26px] leading-none tracking-[-0.02em] tabular-nums">
                    ${ent.hostedSpentUsd.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">/ ${ent.hostedAllowanceUsd.toFixed(2)}</span>
                  </p>
                  <div className="h-1 rounded-full bg-black/[.07] mt-3 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (ent.hostedSpentUsd / Math.max(0.01, ent.hostedAllowanceUsd)) * 100)}%` }} />
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {ent.key
                  ? ent.key.kind === 'wallet'
                    ? ent.key.allFree
                      ? 'New tasks run on your free keys.'
                      : 'New tasks run on your keys — free ones first.'
                    : ent.key.kind === 'byok'
                      ? `New tasks use your ${ent.key.provider === 'openai' ? 'OpenAI' : 'OpenRouter'} key.`
                      : ent.key.fundedBy === 'free_claude'
                        ? `New tasks run free on Claude ${modelLabel(ent.key.model)} — no key needed.`
                        : `New tasks run on our models from your credit, up to $${ent.key.capUsd.toFixed(2)} each.`
                  : ent.reason}
              </p>
            </div>
          )}
        </Section>

        <Section title="Credits" id="credits" className="lg:col-span-2 lg:order-last">
          <CreditsCard
            view={credits}
            busy={busy}
            onBuy={() => run('pack', async () => void (window.location.href = (await startCheckout('pack')).url))}
            onTrial={() =>
              run('trial', async () => {
                const r = await claimTrial()
                await Promise.all([loadCredits(), loadBilling()])
                push(`$${r.usd.toFixed(2)} of free usage added — enough for 2 tasks.`, 'success')
              })
            }
          />
        </Section>

        <Section title="Model keys">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {wallet === null
                ? 'Free and paid model keys live in your Wallet.'
                : wallet.keys.length === 0
                  ? ent?.free?.enabled
                    ? 'No keys yet — your free Claude tasks need none. A free Gemini key makes the free plan unlimited.'
                    : 'No keys yet — a free Gemini key is all you need to start.'
                  : `${wallet.keys.length} key${wallet.keys.length > 1 ? 's' : ''} saved${wallet.capability.allFree ? ', all free' : ''}.`}
            </p>
            <Link to="/wallet" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2">
              Manage keys <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Section>
      </div>
    </AppShell>
  )
}
