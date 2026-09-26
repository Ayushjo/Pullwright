import { useState } from 'react'
import { AlertTriangle, FileCode2, Plus, Trash2 } from 'lucide-react'
import type { Plan } from '../../types/task'
import { Button } from '../ui'

/** Jules-style plan approval: the run starts only after the user approves (optionally editing steps). */
export default function PlanCard({
  plan,
  onApprove,
  onCancel,
  busy,
}: {
  plan: Plan
  onApprove: (edited: { steps?: { title: string; files: string[] }[]; requirements?: string[]; note?: string }) => void
  onCancel: () => void
  busy: boolean
}) {
  const [steps, setSteps] = useState(plan.steps.map((s) => ({ ...s })))
  const [reqs, setReqs] = useState(plan.requirements ?? [])
  const [note, setNote] = useState('')
  const stepsEdited = JSON.stringify(steps) !== JSON.stringify(plan.steps)
  const reqsEdited = JSON.stringify(reqs) !== JSON.stringify(plan.requirements ?? [])
  const edited = stepsEdited || reqsEdited

  return (
    <div className="rounded-xl border border-primary/25 bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-primary/5">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">Proposed plan — review before anything runs</p>
        <p className="text-[13.5px] text-foreground mt-1 leading-relaxed">{plan.summary}</p>
      </div>

      <div className="p-4 space-y-4">
        {reqs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-foreground mb-1.5">Requirements it will be checked against</p>
            <ul className="space-y-1">
              {reqs.map((r, i) => (
                <li key={i} className="group text-[12.5px] text-muted-foreground flex gap-2 items-start">
                  <span className="font-mono text-[10.5px] text-primary mt-0.5">R{i + 1}</span>
                  <span className="flex-1">{r}</span>
                  {reqs.length > 1 && (
                    <button type="button" onClick={() => setReqs((p) => p.filter((_, j) => j !== i))} className="p-0.5 text-muted-foreground/60 hover:text-destructive" title="Drop this requirement">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-foreground mb-1.5">Steps</p>
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="w-5 h-5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground flex items-center justify-center shrink-0 mt-1.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <textarea
                    value={s.title}
                    onChange={(e) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    rows={Math.min(4, Math.max(1, Math.ceil(s.title.length / 80)))}
                    className="w-full text-[13px] text-foreground bg-transparent border border-transparent hover:border-border focus:border-primary/40 focus:outline-none rounded-md px-2 py-1 resize-none"
                  />
                  {s.files.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-2">
                      {s.files.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          <FileCode2 className="w-3 h-3" /> {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {steps.length > 1 && (
                  <button type="button" onClick={() => setSteps((p) => p.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground hover:text-destructive mt-0.5" title="Remove step">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {steps.length < 8 && (
            <button type="button" onClick={() => setSteps((p) => [...p, { title: '', files: [] }])} className="mt-2 ml-7 text-xs text-primary inline-flex items-center gap-1 hover:underline">
              <Plus className="w-3 h-3" /> Add step
            </button>
          )}
        </div>

        {plan.risks && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12.5px] text-foreground">
            <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
            <span>{plan.risks}</span>
          </div>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the agent (e.g. “keep the public API unchanged”)"
          rows={2}
          className="w-full text-[13px] rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:border-primary/40 resize-none"
        />

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel task
          </Button>
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              onApprove({
                ...(stepsEdited ? { steps: steps.filter((s) => s.title.trim().length >= 3) } : {}),
                ...(reqsEdited ? { requirements: reqs } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
          >
            {edited ? 'Approve edited plan' : 'Approve & start'}
          </Button>
        </div>
      </div>
    </div>
  )
}
