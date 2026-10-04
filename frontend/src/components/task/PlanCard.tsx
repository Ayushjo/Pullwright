import { useState } from 'react'
import { AlertTriangle, FileCode2, Plus, Trash2 } from 'lucide-react'
import type { Intake, Plan } from '../../types/task'
import { Button } from '../ui'
import Attachments from './Attachments'

const TIER = { S: { label: 'Small', calls: 11 }, M: { label: 'Medium', calls: 20 }, L: { label: 'Large', calls: 28 } } as const
const CLARITY = ['Clear issue', 'Mostly clear issue', 'Vague issue', 'Unclear issue'] as const
const OTHER = '__other__'

/** Jules-style plan approval: the run starts only after the user approves (optionally editing steps). */
export default function PlanCard({
  taskId,
  plan,
  intake,
  onApprove,
  onReplan,
  onCancel,
  busy,
}: {
  taskId: string
  plan: Plan
  intake?: Intake | undefined
  onApprove: (edited: { steps?: { title: string; files: string[] }[]; requirements?: string[]; note?: string }) => void
  onReplan: (text: string) => void
  onCancel: () => void
  busy: boolean
}) {
  const [steps, setSteps] = useState(plan.steps.map((s) => ({ ...s })))
  const [reqs, setReqs] = useState(plan.requirements ?? [])
  const [note, setNote] = useState('')
  const decisions = plan.assumptions ?? []
  const [picked, setPicked] = useState<string[]>(decisions.map((a) => a.chosen))
  const [other, setOther] = useState<string[]>(decisions.map(() => ''))
  const stepsEdited = JSON.stringify(steps) !== JSON.stringify(plan.steps)
  const reqsEdited = JSON.stringify(reqs) !== JSON.stringify(plan.requirements ?? [])
  const edited = stepsEdited || reqsEdited
  const choice = (i: number) => (picked[i] === OTHER ? other[i]!.trim() : picked[i]!)
  const changed = decisions.map((a, i) => choice(i) && choice(i) !== a.chosen)
  const replan = changed.some(Boolean)
  const tier = plan.tier ? TIER[plan.tier] : null
  const clarity = intake?.spec ? CLARITY[intake.spec.underspec] : null

  const replanText = () =>
    [
      'Decisions for this plan (final — plan around these):',
      ...decisions.map((a, i) => `- ${a.question} → ${choice(i) || a.chosen}`),
      note.trim() ? `\n${note.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')

  return (
    <div className="rounded-lg border border-primary/30 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline bg-primary/5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] text-primary uppercase tracking-[0.08em]">Proposed plan — review before anything runs</p>
          {tier && (
            <span className="font-mono text-[10.5px] rounded-full bg-black/[.05] text-foreground/70 px-2 py-0.5" title={plan.tierReason}>
              {tier.label} · ~{tier.calls} model calls
            </span>
          )}
          {clarity && (
            <span className={`font-mono text-[10.5px] rounded-full px-2 py-0.5 ${intake!.spec!.underspec >= 2 ? 'bg-amber-100 text-amber-800' : 'bg-black/[.05] text-foreground/70'}`}>{clarity}</span>
          )}
        </div>
        <p className="text-[13.5px] text-foreground mt-1 leading-relaxed">{plan.summary}</p>
      </div>

      <div className="p-4 space-y-4">
        {decisions.length > 0 && (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Decisions where the issue left room</p>
            <p className="text-[11.5px] text-muted-foreground mb-2">Pick another option and Pullwright re-plans around it before anything runs.</p>
            <ul className="space-y-2.5">
              {decisions.map((a, i) => {
                const options = [a.chosen, ...a.alternatives.filter((x) => x !== a.chosen)]
                return (
                  <li key={i} className={`rounded-lg border p-2.5 ${changed[i] ? 'border-primary/40 bg-primary/5' : 'border-hairline'}`}>
                    <p className="text-[12.5px] font-medium text-foreground">{a.question}</p>
                    <div className="mt-1.5 space-y-1">
                      {[...options, OTHER].map((o) => (
                        <label key={o} className="flex items-start gap-2 text-[12.5px] text-foreground cursor-pointer">
                          <input
                            type="radio"
                            name={`decision-${i}`}
                            className="mt-0.5 accent-[var(--primary)]"
                            checked={picked[i] === o}
                            onChange={() => setPicked((p) => p.map((x, j) => (j === i ? o : x)))}
                          />
                          {o === OTHER ? (
                            <input
                              value={other[i]}
                              onFocus={() => setPicked((p) => p.map((x, j) => (j === i ? OTHER : x)))}
                              onChange={(e) => setOther((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                              placeholder="Something else…"
                              className="flex-1 min-w-0 text-[12.5px] bg-transparent border-b border-hairline focus:border-primary/40 focus:outline-none"
                            />
                          ) : (
                            <span>
                              {o}
                              {o === a.chosen && <span className="text-muted-foreground"> — planned</span>}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">Why: {a.evidence}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <Attachments taskId={taskId} intake={intake} />

        {reqs.length > 0 && (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mb-2">Requirements it will be checked against</p>
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
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mb-2">Steps</p>
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="w-5 shrink-0 mt-1.5 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                <div className="flex-1 min-w-0">
                  <textarea
                    value={s.title}
                    onChange={(e) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    rows={Math.min(4, Math.max(1, Math.ceil(s.title.length / 80)))}
                    className="w-full text-[13px] text-foreground bg-transparent border border-transparent hover:border-hairline focus:border-primary/40 focus:outline-none rounded-md px-2 py-1 resize-none"
                  />
                  {s.files.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-2">
                      {s.files.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 font-mono text-[10.5px] text-foreground/70 bg-black/[.04] rounded px-1.5 py-0.5">
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
          className="w-full text-[13px] rounded-lg border border-hairline bg-background px-3 py-2 focus:outline-none focus:border-primary/40 resize-none"
        />

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel task
          </Button>
          {replan ? (
            <Button size="sm" loading={busy} onClick={() => onReplan(replanText())}>
              Re-plan with my choices
            </Button>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}
