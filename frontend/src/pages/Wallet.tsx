import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldCheck, Sparkles } from 'lucide-react'
import AppShell from '../components/AppShell'
import { Skeleton, useToast, PageHeader } from '../components/ui'
import { addWalletKey, checkWalletKey, deleteWalletKey, getWallet, type WalletProvider, type WalletView } from '../api/client'
import AddKeyBox from '../components/wallet/AddKeyBox'
import CapabilityStrip from '../components/wallet/CapabilityStrip'
import ProviderCard from '../components/wallet/ProviderCard'
import { HandKey, HandUnderline } from '../components/hand/Scribbles'
import { PROVIDER_NAMES } from '../components/wallet/detect'
import { useSeo } from '../lib/seo'

/** Two short notes under the key box: privacy, and the no-keys alternative. */
function NotesBox() {
  return (
    <div className="border border-hairline rounded-lg overflow-hidden bg-card">
      <div className="p-5 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" strokeWidth={1.75} />
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">Private repos stay private.</span> Free Gemini and OpenRouter free models may train on what they see, so they're
          only used for public repos unless you allow it per task.
        </p>
      </div>
      <div className="p-5 flex gap-3 border-t border-hairline">
        <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" strokeWidth={1.75} />
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">Rather not manage keys?</span> Pro runs everything on our models.{' '}
          <Link to="/pricing" className="text-primary hover:underline underline-offset-2">
            See plans
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function Wallet() {
  useSeo({ title: 'Keys', description: 'Pullwright — your tasks, keys and plan.', noindex: true })
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
    <AppShell>
      <PageHeader
        title="Model keys"
        description={
          <span className="block max-w-xl">
            Pullwright runs on keys you bring.{' '}
            <span className="relative inline-block text-foreground">
              Free ones are enough
              <HandUnderline className="text-primary/70" strokeWidth={3} delay={0.25} />
            </span>
            : a Google Gemini key plans and writes the code, and others make it faster and sharper. Free keys are always used first.
          </span>
        }
      />

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {/* Two columns on desktop: adding a key stays in view (sticky) while the provider cards scroll. */}
      <div className="grid gap-8 lg:gap-10 lg:grid-cols-2 lg:items-start">
        <div className="space-y-5 lg:sticky lg:top-[76px]">
          <section className="rounded-lg border border-hairline bg-card p-4 sm:p-5">
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
                      <p className="text-[15px] text-foreground">No keys yet</p>
                      <p className="text-sm text-muted-foreground">Paste one below, or follow the Gemini steps — it takes about a minute and needs no card.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <CapabilityStrip cap={view.capability} stacked />
                    {view.capability.missing && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2"
                      >
                        {view.capability.missing}
                      </motion.p>
                    )}
                  </>
                )}
                <AddKeyBox onAdd={add} focusSignal={focus} hint={hint} />
              </div>
            )}
          </section>
          <NotesBox />
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Providers</h2>
            {view && keys.length > 0 && (
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                {keys.length} saved{view.capability.allFree ? ' · all free' : ''}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {view === null
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
              : providers.map((g) => (
                  <ProviderCard
                    key={g.id}
                    guide={g}
                    saved={savedBy.get(g.id)}
                    startHere={!view.capability.canRun && g.id === 'gemini'}
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
        </div>
      </div>
    </AppShell>
  )
}
