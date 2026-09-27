import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  ChevronRight,
  Eye,
  FilePen,
  FilePlus2,
  FolderTree,
  GitPullRequest,
  HelpCircle,
  ListChecks,
  Package,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import type { TaskEvent } from '../../types/task'
import { statusMeta } from '../../lib/status'
import { cn } from '../../lib/cn'

type ToolRow = {
  kind: 'tool'
  tool: string
  args: Record<string, unknown>
  result?: { success: boolean; output: string; durationMs: number }
}
type Row =
  | ToolRow
  | { kind: 'event'; ev: TaskEvent }

/** Pair each tool_call with its tool_result; drop noise (llm_call, cost, checkpoints). */
function buildRows(events: TaskEvent[]): Row[] {
  const rows: Row[] = []
  let pending: ToolRow | null = null
  for (const ev of events) {
    if (ev.type === 'tool_call') {
      pending = { kind: 'tool', tool: ev.tool, args: ev.args }
      rows.push(pending)
      continue
    }
    if (ev.type === 'tool_result') {
      if (pending && pending.tool === ev.tool && !pending.result) {
        pending.result = { success: ev.success, output: ev.output, durationMs: ev.durationMs }
      } else {
        // Results without a preceding call (e.g. setup): recover the command from "$ cmd" on the first line.
        const m = /^\$ (.+)/.exec(ev.output)
        rows.push({ kind: 'tool', tool: ev.tool, args: m ? { command: m[1] } : {}, result: { success: ev.success, output: ev.output, durationMs: ev.durationMs } })
      }
      pending = null
      continue
    }
    if (['llm_call', 'cost', 'checkpoint', 'metrics_update', 'phase_start', 'phase_end', 'plan_update', 'diff_ready'].includes(ev.type)) continue
    // collapse consecutive identical status rows
    const last = rows[rows.length - 1]
    if (ev.type === 'status' && last?.kind === 'event' && last.ev.type === 'status' && last.ev.status === ev.status) {
      rows[rows.length - 1] = { kind: 'event', ev }
      continue
    }
    rows.push({ kind: 'event', ev })
  }
  return rows
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v))

function toolSummary(t: ToolRow): { icon: React.ReactNode; label: React.ReactNode } {
  const a = t.args
  const code = (s: string) => <code className="font-mono text-[11.5px] text-foreground bg-muted px-1 py-0.5 rounded">{s}</code>
  switch (t.tool) {
    case 'view': {
      const range = a.start_line ? `:${a.start_line}${a.end_line ? `–${a.end_line}` : ''}` : ''
      return { icon: <Eye className="w-3.5 h-3.5" />, label: <>Read {code(`${str(a.path)}${range}`)}</> }
    }
    case 'search':
      return { icon: <Search className="w-3.5 h-3.5" />, label: <>Searched {code(str(a.pattern).slice(0, 80))}{a.path ? <> in {code(str(a.path))}</> : null}</> }
    case 'list_dir':
      return { icon: <FolderTree className="w-3.5 h-3.5" />, label: <>Listed {code(str(a.path) || '.')}</> }
    case 'shell':
      return { icon: <Terminal className="w-3.5 h-3.5" />, label: <>Ran {code(str(a.command).slice(0, 120))}</> }
    case 'setup':
      return { icon: <Package className="w-3.5 h-3.5" />, label: <>Install {code(str(a.command).replace(/^cd (\S+) && /, '$1: ').slice(0, 90))}</> }
    case 'baseline':
      return { icon: <ShieldCheck className="w-3.5 h-3.5" />, label: <>Baseline {code(str(a.command).replace(/^cd (\S+) && /, '$1: ').slice(0, 90))}</> }
    case 'str_replace':
      return { icon: <FilePen className="w-3.5 h-3.5 text-primary" />, label: <>Edited {code(str(a.path))}</> }
    case 'create_file':
      return { icon: <FilePlus2 className="w-3.5 h-3.5 text-primary" />, label: <>Created {code(str(a.path))}</> }
    case 'apply_patch': {
      const files = [...str(a.patch).matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1]!)
      return { icon: <FilePen className="w-3.5 h-3.5 text-primary" />, label: <>Patched {files.slice(0, 3).map((f, i) => <span key={f}>{i ? ', ' : ''}{code(f)}</span>)}{files.length > 3 ? ` +${files.length - 3}` : ''}</> }
    }
    case 'submit_plan':
      return { icon: <ListChecks className="w-3.5 h-3.5 text-primary" />, label: <>Submitted a plan</> }
    case 'update_plan':
      return { icon: <ListChecks className="w-3.5 h-3.5" />, label: <>Updated checklist</> }
    case 'finish':
      return { icon: <CheckCircle2 className="w-3.5 h-3.5 text-success" />, label: <>Finished — sent for validation</> }
    case 'ask_user':
      return { icon: <HelpCircle className="w-3.5 h-3.5 text-primary" />, label: <>Asked a question</> }
    default:
      return { icon: <ChevronRight className="w-3.5 h-3.5" />, label: <>{t.tool}</> }
  }
}

function EditPreview({ t }: { t: ToolRow }) {
  if (t.tool === 'str_replace') {
    return (
      <pre className="text-[11px] font-mono leading-[1.55] overflow-x-auto">
        {str(t.args.old_str).split('\n').slice(0, 30).map((l, i) => (
          <div key={`o${i}`} className="bg-red-50 text-red-800 px-2 whitespace-pre">- {l}</div>
        ))}
        {str(t.args.new_str).split('\n').slice(0, 40).map((l, i) => (
          <div key={`n${i}`} className="bg-green-50 text-green-800 px-2 whitespace-pre">+ {l}</div>
        ))}
      </pre>
    )
  }
  const text = t.tool === 'apply_patch' ? str(t.args.patch) : t.tool === 'create_file' ? str(t.args.content) : ''
  return (
    <pre className="text-[11px] font-mono leading-[1.55] overflow-x-auto max-h-80">
      {text.split('\n').slice(0, 80).map((l, i) => (
        <div
          key={i}
          className={cn(
            'px-2 whitespace-pre',
            t.tool === 'create_file' || l.startsWith('+') ? 'bg-green-50 text-green-800' : l.startsWith('-') ? 'bg-red-50 text-red-800' : l.startsWith('***') || l.startsWith('@@') ? 'text-muted-foreground' : '',
          )}
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

function ToolItem({ t }: { t: ToolRow }) {
  const [open, setOpen] = useState(false)
  const { icon, label } = toolSummary(t)
  const isEdit = ['str_replace', 'apply_patch', 'create_file'].includes(t.tool)
  const failed = t.result && !t.result.success
  const failLabel =
    t.tool === 'shell' ? 'failed' : t.tool === 'baseline' ? 'already failing' : t.tool === 'finish' ? 'sent back' : isEdit ? 'not applied' : 'error'
  const hasBody = isEdit || Boolean(t.result?.output)
  return (
    <div className="group">
      <button
        type="button"
        onClick={() => hasBody && setOpen((o) => !o)}
        className={cn('w-full flex items-center gap-2 py-1.5 text-left text-[12.5px] text-muted-foreground', hasBody && 'hover:text-foreground')}
      >
        <span className={cn('shrink-0', failed ? 'text-destructive' : '')}>{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        {!t.result && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
        {failed && <span className="text-[10px] font-medium text-destructive bg-red-50 border border-red-200 rounded px-1.5 shrink-0">{failLabel}</span>}
        {hasBody && <ChevronRight className={cn('w-3 h-3 ml-auto shrink-0 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && (
        <div className="ml-5 mb-2 rounded-lg border border-border bg-card overflow-hidden">
          {isEdit && <EditPreview t={t} />}
          {t.result?.output && (!isEdit || failed) && (
            <pre className="text-[11px] font-mono leading-[1.55] whitespace-pre-wrap break-words p-2.5 max-h-72 overflow-y-auto text-muted-foreground border-t border-border first:border-t-0">
              {t.result.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function EventItem({ ev }: { ev: TaskEvent }) {
  switch (ev.type) {
    case 'status': {
      const m = statusMeta(ev.status)
      return (
        <div className="flex items-center gap-2 pt-3 pb-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</span>
          {ev.detail && <span className="text-[11px] text-muted-foreground truncate">· {ev.detail}</span>}
          <span className="flex-1 h-px bg-border" />
        </div>
      )
    }
    case 'agent_thought':
      return (
        <div className="flex gap-2 py-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{ev.text}</p>
        </div>
      )
    case 'plan_ready':
      return (
        <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-semibold text-primary mb-1">Plan</p>
          <p className="text-[13px] text-foreground">{ev.plan.summary}</p>
          <ol className="mt-2 space-y-0.5 list-decimal list-inside text-[12.5px] text-muted-foreground">
            {ev.plan.steps.map((s, i) => <li key={i}>{s.title}</li>)}
          </ol>
        </div>
      )
    case 'gate_result':
      return (
        <div className={cn('my-2 rounded-lg border p-3', ev.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
          <p className={cn('text-xs font-semibold flex items-center gap-1.5', ev.ok ? 'text-success' : 'text-warning')}>
            <ShieldCheck className="w-3.5 h-3.5" /> Validation {ev.ok ? 'passed' : 'found problems'}
          </p>
          {ev.verify.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ev.verify.map((v) => (
                <span key={v.cmd} className="font-mono text-[10.5px] bg-card border border-border rounded px-1.5 py-0.5">
                  {v.after === 0 ? '✓' : v.before !== 0 && v.before !== null ? '•' : '✗'} {v.cmd.replace(/^cd \S+ && /, '')}
                </span>
              ))}
            </div>
          )}
          {!ev.ok && (
            <ul className="mt-2 space-y-1 text-[12px] text-foreground list-disc list-inside">
              {ev.problems.map((p, i) => {
                const [head, ...rest] = p.split('\n')
                const detail = rest.map((l) => l.trim()).filter(Boolean)
                return (
                  <li key={i} className="whitespace-pre-wrap">
                    {head}
                    {detail.length > 0 && (
                      <div className="mt-0.5 ml-4 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                        {detail.slice(0, 6).map((d, j) => (
                          <div key={j}>{d}</div>
                        ))}
                        {detail.length > 6 && <div>+{detail.length - 6} more</div>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )
    case 'judge_result':
      return (
        <div className={cn('my-2 rounded-lg border p-3', ev.success ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
          <p className={cn('text-xs font-semibold flex items-center gap-1.5', ev.success ? 'text-success' : 'text-warning')}>
            <Scale className="w-3.5 h-3.5" /> Reviewer: {ev.success ? 'looks good' : 'changes needed'} · {ev.confidence} confidence
          </p>
          <p className="text-[12.5px] text-foreground mt-1">{ev.explanation}</p>
          {ev.requirements && ev.requirements.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {ev.requirements.map((r, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className={r.met ? 'text-success' : 'text-destructive'}>{r.met ? '✓' : '✗'}</span>
                  <span className="text-muted-foreground">{r.item.replace(/^R\d+\.\s*/, '')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'question':
      return (
        <div className="my-2 rounded-lg border border-primary/30 bg-primary/5 p-3 flex gap-2">
          <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[13px] text-foreground whitespace-pre-wrap">{ev.question}</p>
        </div>
      )
    case 'user_message':
      return (
        <div className="flex justify-end my-2">
          <p className="max-w-[80%] text-[13px] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 whitespace-pre-wrap">{ev.text}</p>
        </div>
      )
    case 'notice':
      return (
        <div className="flex items-center gap-2 py-1 text-[12px] text-warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {ev.message}
        </div>
      )
    case 'pr_opened':
      return (
        <a href={ev.prUrl} target="_blank" rel="noreferrer" className="my-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-[13px] font-medium text-success hover:underline">
          <GitPullRequest className="w-4 h-4" /> Pull request opened
        </a>
      )
    case 'task_failed':
      return (
        <div className="my-2 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-destructive">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span className="whitespace-pre-wrap">{ev.reason}</span>
        </div>
      )
    default:
      return null
  }
}

export default function ActivityFeed({
  events,
  live,
  loading = false,
  followKey,
}: {
  events: TaskEvent[]
  live: boolean
  loading?: boolean
  /** Changes on each phase change (e.g. plan approved) — the feed jumps back to live when it does. */
  followKey?: string
}) {
  const rows = useMemo(() => buildRows(events), [events])
  const scroller = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  // Row count when the user scrolled away from the bottom; everything after it is "new".
  const [seenCount, setSeenCount] = useState(rows.length)
  const unseen = stick ? 0 : Math.max(0, rows.length - seenCount)

  // A phase change (e.g. plan approved) jumps back to live.
  const [lastFollowKey, setLastFollowKey] = useState(followKey)
  if (followKey !== lastFollowKey) {
    setLastFollowKey(followKey)
    setStick(true)
  }

  // Scroll only the feed itself; scrollIntoView would also drag the whole page down.
  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }
  useEffect(() => {
    if (stick) toBottom()
  }, [rows.length, stick])

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          if (stick && !atBottom) setSeenCount(rows.length)
          setStick(atBottom)
        }}
        className="h-full overflow-y-auto px-4 sm:px-5 py-3"
      >
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">{loading ? 'Loading activity…' : live ? 'Starting…' : 'No activity recorded.'}</p>
        )}
        {rows.map((r, i) => (r.kind === 'tool' ? <ToolItem key={i} t={r} /> : <EventItem key={i} ev={r.ev} />))}
        {live && (
          <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Working…
          </div>
        )}
      </div>
      {!stick && unseen > 0 && (
        <button
          onClick={() => {
            toBottom()
            setStick(true)
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground shadow-md hover:bg-primary/90"
        >
          <ArrowDown className="w-3.5 h-3.5" /> {unseen} new {unseen === 1 ? 'step' : 'steps'}
        </button>
      )}
    </div>
  )
}
