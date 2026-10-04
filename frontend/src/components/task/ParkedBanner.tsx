import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { PauseCircle } from 'lucide-react'
import { Button } from '../ui'

/** "14:05", or "Mon 05:30" when it isn't today. */
function when(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/** Shown while a task waits for free model quota (or for a key): why, when it resumes, and what the user can do. */
export default function ParkedBanner({
  park,
  busy,
  onResume,
  onCancel,
}: {
  park: { stage: 'plan' | 'run'; until: number | null; reason: string; count: number }
  busy: string | null
  onResume: () => void
  onCancel: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = park.until === null ? null : Math.max(0, park.until - now)
  const fmt = (ms: number) => {
    const m = Math.floor(ms / 60_000)
    const h = Math.floor(m / 60)
    return h ? `${h} h ${m % 60} min` : m ? `${m} min` : `${Math.ceil(ms / 1000)} s`
  }
  return (
    <div className="shrink-0 p-3 sm:p-4 border-b border-border bg-muted/40">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <PauseCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              {park.until === null
                ? 'Paused — no model is available with your keys'
                : `Paused while the free model quota resets — resumes in ${fmt(left!)}`}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {park.stage === 'run'
                ? 'Your progress is saved; it continues exactly where it stopped.'
                : 'The plan will be drafted as soon as a model is available.'}{' '}
              {park.until !== null && `Resumes about ${when(park.until)}.`}{' '}
              <Link to="/wallet" className="text-primary hover:underline underline-offset-2">
                Adding another key
              </Link>{' '}
              lets it continue now.
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-1 break-words">{park.reason}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 pl-8 sm:pl-0">
          <Button size="sm" variant="secondary" loading={busy === 'resume'} onClick={onResume}>
            Resume now
          </Button>
          <Button size="sm" variant="ghost" loading={busy === 'cancel'} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
