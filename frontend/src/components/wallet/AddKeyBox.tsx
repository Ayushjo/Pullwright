import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ClipboardPaste, Eye, EyeOff, Lock } from 'lucide-react'
import type { WalletProvider } from '../../api/client'
import StatusButton, { type ButtonStatus } from '../fx/StatusButton'
import { detectProvider, PROVIDER_NAMES } from './detect'
import { cn } from '../../lib/cn'

/**
 * Paste any supported key; we name the provider as you paste, check it with the provider (no tokens spent)
 * and save it encrypted. `focusSignal` lets a provider card focus this box.
 */
export default function AddKeyBox({
  onAdd,
  focusSignal,
  hint,
}: {
  onAdd: (key: string, provider?: WalletProvider) => Promise<void>
  focusSignal?: number
  hint?: WalletProvider | null
}) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState<ButtonStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const detected = detectProvider(value)

  useEffect(() => {
    if (focusSignal) input.current?.focus()
  }, [focusSignal])

  const submit = async () => {
    if (!value.trim() || status === 'loading') return
    setError(null)
    setStatus('loading')
    try {
      await onAdd(value.trim(), detected ?? hint ?? undefined)
      setStatus('success')
      setValue('')
      setShow(false)
      setTimeout(() => setStatus('idle'), 1600)
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
      setTimeout(() => setStatus((s) => (s === 'error' ? 'idle' : s)), 1800)
    }
  }

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setValue(t.trim())
      input.current?.focus()
    } catch {
      input.current?.focus()
    }
  }

  const looksWrong = value.trim().length > 12 && !detected
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-2"
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <div
          className={cn(
            'relative flex-1 min-w-0 flex items-center rounded-input border bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15',
            error ? 'border-red-300' : 'border-black/15',
          )}
        >
          <Lock className="w-4 h-4 ml-3 text-muted-foreground shrink-0" strokeWidth={1.75} />
          <input
            ref={input}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError(null)
            }}
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            aria-label="API key"
            placeholder="Paste a key — AIza…, gsk_…, vck_…, sk-or-…"
            className="flex-1 min-w-0 bg-transparent px-2.5 py-2.5 text-sm font-mono outline-none placeholder:font-sans placeholder:text-muted-foreground/80"
          />
          <AnimatePresence>
            {detected && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8, filter: 'blur(3px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.8, filter: 'blur(3px)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                className="hidden min-[380px]:inline-flex shrink-0 items-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-2 py-0.5 mr-1 whitespace-nowrap"
              >
                {PROVIDER_NAMES[detected]}
              </motion.span>
            )}
          </AnimatePresence>
          {value ? (
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'} className="p-2 mr-1 text-muted-foreground hover:text-foreground rounded-md focus-ring">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          ) : (
            <button type="button" onClick={paste} className="inline-flex items-center gap-1 px-2 py-1 mr-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-muted focus-ring">
              <ClipboardPaste className="w-3.5 h-3.5" />
              Paste
            </button>
          )}
        </div>
        <StatusButton
          type="submit"
          status={status}
          disabled={!value.trim()}
          labels={{ idle: 'Add key', loading: 'Checking', success: 'Saved', error: 'Try again' }}
          className="w-full sm:w-auto py-2.5"
        />
      </div>
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-red-700" role="alert">
            {error}
          </motion.p>
        ) : looksWrong ? (
          <motion.p key="wrong" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-amber-700">
            We don't recognise this format{hint ? ` — we'll try it as ${PROVIDER_NAMES[hint]}` : ''}.
          </motion.p>
        ) : (
          <motion.p key="note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-muted-foreground">
            Checked with the provider without spending anything, then stored encrypted. It never comes back to your browser.
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  )
}
