import { CheckCircle2, CircleAlert, Scale, ShieldCheck, XCircle } from 'lucide-react'
import type { TaskState } from '../../types/task'
import { cn } from '../../lib/cn'

/** Everything a human needs to decide whether to publish: requirements, verification, warnings. */
export default function ReviewPanel({ state }: { state: TaskState }) {
  const v = state.verdict
  const g = state.gate
  return (
    <div className="space-y-4">
      {state.summary && (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-foreground mb-1.5">What the agent did</p>
          <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{state.summary}</p>
        </section>
      )}

      {v && (
        <section className={cn('rounded-xl border p-4', v.success ? 'border-green-200 bg-green-50/60' : 'border-amber-200 bg-amber-50/60')}>
          <p className={cn('text-xs font-semibold flex items-center gap-1.5 mb-1', v.success ? 'text-success' : 'text-warning')}>
            <Scale className="w-3.5 h-3.5" /> Independent review — {v.success ? 'meets the issue' : 'needs attention'} ({v.confidence} confidence)
          </p>
          <p className="text-[13px] text-foreground">{v.explanation}</p>
          {v.requirements && v.requirements.length > 0 && (
            <ul className="mt-3 space-y-2">
              {v.requirements.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12.5px]">
                  {r.met ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-foreground">{r.item.replace(/^R\d+\.\s*/, '')}</p>
                    <p className="text-muted-foreground text-[11.5px] mt-0.5">{r.evidence}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {v.concerns.filter((c) => !c.startsWith('Unmet:')).length > 0 && (
            <ul className="mt-3 space-y-1 text-[12.5px] text-foreground list-disc list-inside">
              {v.concerns.filter((c) => !c.startsWith('Unmet:')).map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </section>
      )}

      {g && (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className={cn('text-xs font-semibold flex items-center gap-1.5 mb-2', g.ok ? 'text-success' : 'text-warning')}>
            <ShieldCheck className="w-3.5 h-3.5" /> Automated validation {g.ok ? 'passed' : 'did not pass'}
          </p>
          {g.verify.length > 0 ? (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-medium pb-1">Check (run in the sandbox)</th>
                  <th className="font-medium pb-1 w-20 text-center">Before</th>
                  <th className="font-medium pb-1 w-20 text-center">After</th>
                </tr>
              </thead>
              <tbody>
                {g.verify.map((r) => (
                  <tr key={r.cmd} className="border-t border-border">
                    <td className="py-1.5 font-mono text-[11px] text-foreground pr-2">
                      {r.cmd}
                      {r.newFailures.length > 0 && <p className="text-destructive font-sans mt-0.5">New failures: {r.newFailures.join('; ')}</p>}
                      {r.fixed.length > 0 && <p className="text-success font-sans mt-0.5">Now passing: {r.fixed.join('; ')}</p>}
                    </td>
                    <td className="text-center">{r.before === null ? '—' : r.before === 0 ? '✅' : '❌'}</td>
                    <td className="text-center">{r.after === 0 ? '✅' : '❌'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">No test or type-check commands were detected for this repository.</p>
          )}
          {[...g.problems, ...g.warnings].length > 0 && (
            <ul className="mt-3 space-y-1">
              {g.problems.map((p, i) => (
                <li key={`p${i}`} className="flex gap-1.5 text-[12px] text-destructive"><CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span className="whitespace-pre-wrap">{p.split('\n')[0]}</span></li>
              ))}
              {g.warnings.map((w, i) => (
                <li key={`w${i}`} className="flex gap-1.5 text-[12px] text-muted-foreground"><CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{w}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!v && !g && <p className="text-sm text-muted-foreground text-center py-12">The review appears here once the agent finishes.</p>}
    </div>
  )
}
