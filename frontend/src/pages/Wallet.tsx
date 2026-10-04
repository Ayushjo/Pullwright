import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldCheck, Sparkles } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Skeleton, useToast } from '../components/ui'
import { addWalletKey, checkWalletKey, deleteWalletKey, getWallet, type WalletProvider, type WalletView } from '../api/client'
import AddKeyBox from '../components/wallet/AddKeyBox'
import CapabilityStrip from '../components/wallet/CapabilityStrip'
import ProviderCard from '../components/wallet/ProviderCard'
import { HandKey, HandUnderline } from '../components/hand/Scribbles'
import { PROVIDER_NAMES } from '../components/wallet/detect'

export default function Wallet() {
  const { push } = useToast()
  const [view, setView] = useState<WalletView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const [hint, setHint] = useState<WalletProvider | null>(null)

  useEffect(() => {
    getWallet()
      .then(setView)
      .catch((e: Error) => setError(e.message))
  }, [])

  const add = useCallback(
    async (key: string, provider?: WalletProvider) => {
      const v = await addWalletKey(key, provider)
      setView(v)
      push(`${PROVIDER_NAMES[v.added]} key saved`, 'success')
    },
    [push],
  )

  const remove = useCallback(
    (p: WalletProvider) => {
      deleteWalletKey(p)
        .then((v) => {
          setView(v)
          push(`${PROVIDER_NAMES[p]} key removed`, 'info')
        })
        .catch((e: Error) => push(e.message, 'error'))
    },
    [push],
  )

  const recheck = async (p: WalletProvider) => {
    try {
      setView(await checkWalletKey(p))
      push(`${PROVIDER_NAMES[p]} key is working`, 'success')
    } catch (e) {
      push((e as Error).message, 'error')
    }
  }

  const keys = view?.keys ?? []
  const savedBy = new Map(keys.map((k) => [k.provider, k]))
  const empty = view !== null && keys.length === 0
  // Saved keys first, then the rest in the guide's order (Gemini, Groq, Vercel, OpenRouter, OpenAI).
  const providers = view ? [...view.providers].sort((a, b) => Number(savedBy.has(b.id)) - Number(savedBy.has(a.id))) : []

  return (
    <AppShell maxWidth="max-w-3xl">
      <div className="relative">
        <h1 className="text-2xl font-bold text-foreground mb-1">Model keys</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-xl">
          Pullwright runs on keys you bring.{' '}
          <span className="relative inline-block text-foreground font-medium">
            Free ones are enough
            <HandUnderline className="text-primary/70" strokeWidth={3} delay={0.25} />
          </span>
          : a Google Gemini key plans and writes the code, and others make it faster and sharper. Free keys are always used first.
        </p>
      </div>

      {error && <p className="text-sm text-red-700 mb-4">{error}</p>}

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 mb-5">
        {view === null ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <div className="space-y-4">
            {empty ? (
              <div className="flex items-center gap-4">
                <HandKey className="w-20 h-14 shrink-0 text-primary/70" />
                <div>
                  <p className="text-sm font-semibold text-foreground">No keys yet</p>
                  <p className="text-sm text-muted-foreground">Paste one below, or follow the Gemini steps — it takes about a minute and needs no card.</p>
                </div>
              </div>
            ) : (
              <>
                <CapabilityStrip cap={view.capability} />
                {view.capability.missing && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {view.capability.missing}
                  </motion.p>
                )}
              </>
            )}
            <AddKeyBox onAdd={add} focusSignal={focus} hint={hint} />
          </div>
        )}
      </section>

      <div className="flex items-baseline justify-between mb-3 mt-8">
        <h2 className="text-sm font-semibold text-foreground">Providers</h2>
        {view && keys.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {keys.length} saved{view.capability.allFree ? ' · all free' : ''}
          </span>
        )}
      </div>

      <div className={empty ? 'space-y-3 pt-10' : 'space-y-3'}>
        {view === null
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
          : providers.map((g) => (
              <ProviderCard
                key={g.id}
                guide={g}
                saved={savedBy.get(g.id)}
                startHere={empty && g.id === 'gemini'}
                onAddClick={() => {
                  setHint(g.id)
                  setFocus((n) => n + 1)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                onRecheck={() => recheck(g.id)}
                onRemove={() => remove(g.id)}
              />
            ))}
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4 flex gap-3">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Private repos stay private.</span> Free Gemini and OpenRouter free models may train on what they see, so
            they're only used for public repos unless you allow it per task.
          </p>
        </div>
        <div className="rounded-xl border border-border p-4 flex gap-3">
          <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Rather not manage keys?</span> Pro runs everything on our models.{' '}
            <Link to="/pricing" className="text-primary font-medium hover:underline underline-offset-2">
              See plans
            </Link>
          </p>
        </div>
      </div>
    </AppShell>
  )
}
