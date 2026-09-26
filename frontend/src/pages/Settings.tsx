import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Badge, Button, Input, useToast } from '../components/ui'
import {
  deleteApiKey,
  getBilling,
  openBillingPortal,
  saveApiKey,
  startCheckout,
  type BillingInfo,
  type KeyProvider,
} from '../api/client'

const PROVIDERS: { id: KeyProvider; name: string; hint: string; placeholder: string }[] = [
  { id: 'openai', name: 'OpenAI', hint: 'Uses gpt-5-mini by default — typically a few cents per task.', placeholder: 'sk-…' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'One key for many models (default openai/gpt-5-mini).', placeholder: 'sk-or-…' },
]

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
  const [drafts, setDrafts] = useState<Record<KeyProvider, string>>({ openai: '', openrouter: '' })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    getBilling()
      .then(setInfo)
      .catch((e: Error) => setError(e.message))
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
                    Upgrade to Pro — $12/mo
                  </Button>
                ) : (
                  <Link to="/pricing" className="text-sm text-primary hover:underline">See plans</Link>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Runs this month</p>
                  <p className="text-lg font-semibold tabular-nums">{ent.runsUsed} <span className="text-sm text-muted-foreground font-normal">/ {ent.runsIncluded}</span></p>
                  <div className="h-1.5 rounded-full bg-border mt-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (ent.runsUsed / Math.max(1, ent.runsIncluded)) * 100)}%` }} />
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{pro ? 'Included model usage' : 'Model usage'}</p>
                  {pro ? (
                    <p className="text-lg font-semibold tabular-nums">${ent.hostedSpentUsd.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">/ ${ent.hostedAllowanceUsd.toFixed(2)}</span></p>
                  ) : (
                    <p className="text-sm text-foreground mt-1">Billed to your own key — Pullwright adds no markup.</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {ent.key
                  ? ent.key.kind === 'byok'
                    ? `New tasks use your ${ent.key.provider === 'openai' ? 'OpenAI' : 'OpenRouter'} key.`
                    : 'New tasks use your included Pro model usage.'
                  : ent.reason?.replace(' in Settings', ' below')}
              </p>
            </div>
          )}
        </Section>

        <Section title="Your API keys" icon={<KeyRound className="w-4 h-4 text-primary" />}>
          <p className="text-[13px] text-muted-foreground mb-4 flex items-start gap-1.5">
            <ShieldCheck className="w-4 h-4 text-success shrink-0" />
            Keys are verified with the provider, encrypted at rest (AES-256-GCM), used only by the worker for your tasks, and never shown or logged.
          </p>
          <div className="space-y-4">
            {PROVIDERS.map((p) => {
              const saved = info?.keys.find((k) => k.provider === p.id)
              return (
                <div key={p.id} className="rounded-lg border border-border p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-foreground">{p.name}</p>
                    {saved && (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">•••• {saved.last4}</span>
                        <button
                          type="button"
                          title="Remove key"
                          className="p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => run(`del-${p.id}`, async () => {
                            const r = await deleteApiKey(p.id)
                            setInfo((i) => (i ? { ...i, keys: r.keys } : i))
                            setInfo(await getBilling())
                            push('Key removed', 'success')
                          })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2.5">{p.hint}</p>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const key = drafts[p.id].trim()
                      if (!key) return
                      void run(`save-${p.id}`, async () => {
                        await saveApiKey(p.id, key)
                        setDrafts((d) => ({ ...d, [p.id]: '' }))
                        setInfo(await getBilling())
                        push(`${p.name} key saved`, 'success')
                      })
                    }}
                  >
                    <div className="flex-1 min-w-0">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={saved ? 'Replace key…' : p.placeholder}
                      value={drafts[p.id]}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                    </div>
                    <Button type="submit" size="md" variant="secondary" loading={busy === `save-${p.id}`} disabled={!drafts[p.id].trim()}>
                      {saved ? 'Replace' : 'Save'}
                    </Button>
                  </form>
                </div>
              )
            })}
          </div>
        </Section>
      </div>
    </AppShell>
  )
}
