import { useEffect, useState } from 'react'
import { FileText, Film, ImageOff } from 'lucide-react'
import type { Intake, IntakeAttachment } from '../../types/task'
import { attachmentObjectUrl } from '../../api/client'

/** Issue attachments and what the vision model read in them, so a misread is caught before any code is written. */
export default function Attachments({ taskId, intake }: { taskId: string; intake?: Intake | undefined }) {
  const items = intake?.attachments ?? []
  if (!items.length) return null
  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-1.5">What Pullwright read in the issue’s attachments</p>
      <ul className="space-y-2">
        {items.map((a) => (
          <AttachmentRow key={a.n} taskId={taskId} a={a} />
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-1.5">Images are transcribed by a vision model. If something was misread, say so in the note below.</p>
    </div>
  )
}

function AttachmentRow({ taskId, a }: { taskId: string; a: IntakeAttachment }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!a.hasImage) return
    let url: string | null = null
    let alive = true
    void attachmentObjectUrl(taskId, a.n).then((u) => {
      url = u
      if (alive) setSrc(u)
      else if (u) URL.revokeObjectURL(u)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [taskId, a.n, a.hasImage])

  const Icon = a.kind === 'video' ? Film : a.kind === 'file' ? FileText : ImageOff
  return (
    <li className="flex gap-3 rounded-lg border border-border p-2">
      {a.hasImage && src ? (
        <a href={src} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={src} alt={a.alt || `Attachment ${a.n}`} className="w-24 h-16 object-cover object-top rounded border border-border bg-muted" />
        </a>
      ) : (
        <div className="w-24 h-16 shrink-0 rounded bg-muted flex items-center justify-center text-muted-foreground">
          {a.hasImage ? <span className="w-full h-full rounded bg-muted animate-pulse" /> : <Icon className="w-4 h-4" />}
        </div>
      )}
      <div className="flex-1 min-w-0 text-[12px] leading-relaxed">
        <p className="text-muted-foreground">
          #{a.n} · {a.kind} · {a.where}
          {a.alt ? ` · “${a.alt}”` : ''}
        </p>
        {a.skipped ? (
          <p className="text-warning">Not used: {a.skipped}</p>
        ) : a.vision ? (
          <>
            {a.vision.visibleText && (
              <p className="text-foreground">
                <span className="text-muted-foreground">Text: </span>
                <span className="font-mono text-[11.5px]">{a.vision.visibleText}</span>
              </p>
            )}
            {a.vision.whatLooksWrong && (
              <p className="text-foreground">
                <span className="text-muted-foreground">Looks wrong: </span>
                {a.vision.whatLooksWrong}
              </p>
            )}
          </>
        ) : (
          <p className="text-foreground whitespace-pre-wrap line-clamp-4">{a.description ?? 'No transcript.'}</p>
        )}
      </div>
    </li>
  )
}
