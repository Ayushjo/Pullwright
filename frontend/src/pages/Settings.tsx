import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, KeyRound, Sparkles } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Badge, Button, useToast } from '../components/ui'
import CapacityMeter from '../components/wallet/CapacityMeter'
import { getBilling, getWallet, openBillingPortal, startCheckout, type BillingInfo, type WalletView } from '../api/client'

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/40 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function Settings() {
  const { push } = useToast()
  const [info, setInfo] = useState<BillingInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<WalletView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    getBilling()
      .then(setInfo)
      .catch((e: Error) => setError(e.message))
    getWallet()
      .then(setWallet)
      .catch(() => setWallet(null))
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') === 'success') push('Thanks! Your Pro plan activates as soon as the payment is confirmed.', 'success')
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
    <AppShell maxWidth="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-6">Your plan, usage and model keys.</p>
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      <div className="space-y-5">
        <Section title="Plan & usage" icon={<Sparkles className="w-4 h-4 text-primary" />}>
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
                  <Button size="sm" variant="secondary" loading={busy === 'portal'} onClick={() => run('portal', async () => void (window.location.href = (await openBillingPortal()).url))}>
                    Manage billing
                  </Button>
                ) : info?.paymentsEnabled ? (
                  <Button size="sm" loading={busy === 'checkout'} onClick={() => run('checkout', async () => void (window.location.href = (await startCheckout()).url))}>
                    Upgrade to Pro
                  </Button>
                ) : (
                  <Link to="/pricing" className="text-sm text-primary hover:underline">See plans</Link>
                )}
              </div>
              <CapacityMeter className="w-fit max-w-full" />
              {pro && (
                <div className="rounded-lg border border-border p-3 sm:max-w-xs">
                  <p className="text-xs text-muted-foreground">Included model usage this month</p>
                  <p className="text-lg font-semibold tabular-nums">
                    ${ent.hostedSpentUsd.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">/ ${ent.hostedAllowanceUsd.toFixed(2)}</span>
                  </p>
                  <div className="h-1.5 rounded-full bg-border mt-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (ent.hostedSpentUsd / Math.max(0.01, ent.hostedAllowanceUsd)) * 100)}%` }} />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {ent.key
                  ? ent.key.kind === 'wallet'
                    ? ent.key.allFree
                      ? 'New tasks run on your free keys.'
                      : 'New tasks run on your keys — free ones first.'
                    : ent.key.kind === 'byok'
                      ? `New tasks use your ${ent.key.provider === 'openai' ? 'OpenAI' : 'OpenRouter'} key.`
                      : 'New tasks use your included Pro model usage.'
                  : ent.reason}
              </p>
            </div>
          )}
        </Section>

        <Section title="Model keys" icon={<KeyRound className="w-4 h-4 text-primary" />}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {wallet === null
                ? 'Free and paid model keys live in your Wallet.'
                : wallet.keys.length === 0
                  ? 'No keys yet — a free Gemini key is all you need to start.'
                  : `${wallet.keys.length} key${wallet.keys.length > 1 ? 's' : ''} saved${wallet.capability.allFree ? ', all free' : ''}.`}
            </p>
            <Link to="/wallet" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2">
              Open Wallet <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Section>
      </div>
    </AppShell>
  )
}
