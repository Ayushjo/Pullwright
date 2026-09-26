import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '../../lib/cn'

export default function Composer({
  placeholder,
  onSend,
  disabled,
  autoFocus,
}: {
  placeholder: string
  onSend: (text: string) => Promise<void> | void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await onSend(t)
      setText('')
    } finally {
      setSending(false)
    }
  }
  return (
    <div className={cn('flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary/40', disabled && 'opacity-60')}>
      <textarea
        value={text}
        autoFocus={autoFocus}
        disabled={disabled || sending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none max-h-32 py-1"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={disabled || sending || !text.trim()}
        className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0"
        title="Send (Enter)"
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </div>
  )
}
