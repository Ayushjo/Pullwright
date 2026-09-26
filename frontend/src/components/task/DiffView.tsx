import { useMemo, useState } from 'react'
import { ChevronRight, FileMinus2, FilePen, FilePlus2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { parsePatch, type FileDiff } from '../../lib/diff'

function hunkLineNumbers(lines: string[]) {
  let o = 0
  let n = 0
  return lines.map((l) => {
    const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) {
      o = Number(m[1])
      n = Number(m[2])
      return { l, o: null as number | null, n: null as number | null, kind: 'hunk' as const }
    }
    if (l.startsWith('+')) return { l, o: null, n: n++, kind: 'add' as const }
    if (l.startsWith('-')) return { l, o: o++, n: null, kind: 'del' as const }
    if (l.startsWith('\\')) return { l, o: null, n: null, kind: 'meta' as const }
    return { l, o: o++, n: n++, kind: 'ctx' as const }
  })
}

function FileBlock({
  f,
  rejected,
  onToggle,
  editable,
}: {
  f: FileDiff
  rejected: boolean
  onToggle?: (rejected: boolean) => void
  editable: boolean
}) {
  const [open, setOpen] = useState(f.lines.length < 400)
  const Icon = f.status === 'A' ? FilePlus2 : f.status === 'D' ? FileMinus2 : FilePen
  const rows = useMemo(() => hunkLineNumbers(f.lines), [f.lines])
  return (
    <div className={cn('rounded-xl border border-border bg-card overflow-hidden', rejected && 'opacity-60')}>
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <ChevronRight className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0', open && 'rotate-90')} />
          <Icon className={cn('w-3.5 h-3.5 shrink-0', f.status === 'A' ? 'text-success' : f.status === 'D' ? 'text-destructive' : 'text-primary')} />
          <span className={cn('font-mono text-[12px] text-foreground truncate', rejected && 'line-through')}>{f.path}</span>
          <span className="text-[11px] tabular-nums shrink-0">
            <span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span>
          </span>
        </button>
        {editable && onToggle && (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0 cursor-pointer select-none">
            <input type="checkbox" checked={!rejected} onChange={(e) => onToggle(!e.target.checked)} className="accent-[var(--primary)]" />
            Include
          </label>
        )}
      </div>
      {open && (
        <div className="overflow-x-auto">
          {f.binary ? (
            <p className="text-xs text-muted-foreground p-3">Binary file</p>
          ) : (
            <table className="w-full text-[11.5px] font-mono leading-[1.6] border-collapse">
              <tbody>
                {rows.map((r, i) =>
                  r.kind === 'hunk' ? (
                    <tr key={i} className="bg-primary/5 text-muted-foreground">
                      <td colSpan={3} className="px-3 py-0.5 whitespace-pre">{r.l}</td>
                    </tr>
                  ) : (
                    <tr key={i} className={r.kind === 'add' ? 'bg-green-50' : r.kind === 'del' ? 'bg-red-50' : ''}>
                      <td className="w-10 px-2 text-right text-muted-foreground/70 select-none align-top">{r.o ?? ''}</td>
                      <td className="w-10 px-2 text-right text-muted-foreground/70 select-none align-top">{r.n ?? ''}</td>
                      <td className={cn('pr-3 whitespace-pre', r.kind === 'add' ? 'text-green-900' : r.kind === 'del' ? 'text-red-900' : 'text-foreground')}>{r.l || ' '}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function DiffView({
  patch,
  rejected,
  onToggle,
  editable,
}: {
  patch: string
  rejected: string[]
  onToggle?: (path: string, rejected: boolean) => void
  editable: boolean
}) {
  const files = useMemo(() => parsePatch(patch), [patch])
  if (!files.length) return <p className="text-sm text-muted-foreground text-center py-12">No changes yet.</p>
  const added = files.reduce((a, f) => a + f.added, 0)
  const removed = files.reduce((a, f) => a + f.removed, 0)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {files.length} file{files.length === 1 ? '' : 's'} changed · <span className="text-success">+{added}</span>{' '}
        <span className="text-destructive">−{removed}</span>
        {editable && ' · untick a file to leave it out of the pull request'}
      </p>
      {files.map((f) => (
        <FileBlock key={f.path} f={f} rejected={rejected.includes(f.path)} editable={editable} {...(onToggle ? { onToggle: (r: boolean) => onToggle(f.path, r) } : {})} />
      ))}
    </div>
  )
}
