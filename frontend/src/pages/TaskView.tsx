import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Circle, ExternalLink, GitPullRequest, Globe, Loader2, RotateCcw, Square, Undo2 } from 'lucide-react'
import AppShell from '../components/AppShell'
import ActivityFeed from '../components/task/ActivityFeed'
import DiffView from '../components/task/DiffView'
import PlanCard from '../components/task/PlanCard'
import Attachments from '../components/task/Attachments'
import ParkedBanner from '../components/task/ParkedBanner'
import ReviewPanel from '../components/task/ReviewPanel'
import Composer from '../components/task/Composer'
import { Badge, Button, Tabs, useToast } from '../components/ui'
import { useTask } from '../hooks/useTask'
import {
  approvePlan,
  cancelTask,
  extendBudget,
  getDiff,
  publishTask,
  replanTask,
  resumeTask,
  restoreCheckpoint,
  retryTask,
  sendMessage,
  setFileRejected,
  shareTask,
} from '../api/client'
import { statusMeta } from '../lib/status'
import { cn } from '../lib/cn'

type TabKey = 'activity' | 'changes' | 'review'

function useElapsed(startIso?: string, endIso?: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endIso) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endIso])
  if (!startIso) return ''
  const secs = Math.max(0, Math.floor(((endIso ? Date.parse(endIso) : now) - Date.parse(startIso)) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export default function TaskViewRoute() {
  const { id } = useParams<{ id: string }>()
  // Keyed so navigating between tasks starts from a clean slate.
  return <TaskView key={id} taskId={id ?? ''} />
}

function TaskView({ taskId }: { taskId: string }) {
  const { push } = useToast()
  const { state, events, eventsLoaded, loading, notFound, error, refresh } = useTask(taskId)
  const [pickedTab, setTab] = useState<TabKey | null>(null)
  const [patch, setPatch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [isPublic, setIsPublic] = useState(false)

  const status = state?.status ?? 'queued'
  const meta = statusMeta(status)
  const elapsed = useElapsed(state?.startedAt ?? state?.createdAt, meta.active ? undefined : (state?.finishedAt ?? state?.updatedAt))
  const reviewable = status === 'ready' || status === 'needs_review'
  const fileCount = state?.stats?.length ?? 0
  const patchFiles = (patch.match(/^diff --git /gm) ?? []).length

  // Until the user picks a tab, show the review as soon as the run finishes.
  const tab: TabKey = pickedTab ?? (reviewable ? 'review' : 'activity')

  const loadDiff = useCallback(() => {
    return getDiff(taskId)
      .then((d) => setPatch(d.patch))
      .catch(() => {
        /* not ready yet */
      })
  }, [taskId])
  const updatedAt = state?.updatedAt
  const editCount = events.filter((e) => e.type === 'checkpoint').length
  useEffect(() => {
    // Refresh when files change, and whenever the Changes tab is opened (the live diff may be newer).
    if (fileCount > 0 || editCount > 0 || tab === 'changes') void loadDiff()
  }, [fileCount, editCount, loadDiff, updatedAt, tab])

  const act = useCallback(
    async (key: string, fn: () => Promise<unknown>, ok?: string) => {
      setBusy(key)
      try {
        await fn()
        if (ok) push(ok, 'success')
        await refresh()
      } catch (e) {
        push((e as Error).message, 'error')
      } finally {
        setBusy(null)
      }
    },
    [push, refresh],
  )

  const checklist = useMemo(() => {
    // The latest live plan_update event wins over the (less frequently saved) task state.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!
      if (e.type === 'plan_update' && e.steps.length) return e.steps
      if (e.type === 'plan_ready') break
    }
    if (state?.planChecklist?.length) return state.planChecklist
    return state?.plan?.steps.map((s) => ({ title: s.title, status: 'pending' })) ?? []
  }, [events, state?.planChecklist, state?.plan])

  if (loading && !state) {
    return (
      <AppShell maxWidth="max-w-6xl">
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading task…
        </div>
      </AppShell>
    )
  }
  if (notFound || !state) {
    return (
      <AppShell maxWidth="max-w-6xl">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted-foreground mb-3">{error ?? 'Task not found.'}</p>
          <Link to="/dashboard" className="text-sm text-primary hover:underline">← Back to dashboard</Link>
        </div>
      </AppShell>
    )
  }

  const repoName = state.source ? `local · ${state.repo}` : `${state.owner}/${state.repo}`
  const costPct = Math.min(100, (state.costUsd / Math.max(0.0001, state.capUsd)) * 100)
  const terminal = ['published', 'failed', 'cancelled'].includes(status)

  return (
    <AppShell maxWidth="max-w-[1240px]">
      <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col md:h-[calc(100vh-7rem)] md:min-h-[560px]">
        {/* Header */}
        <div className="shrink-0 px-3 sm:px-5 py-3 sm:py-4 border-b border-border bg-muted/50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Link to="/dashboard" className="w-8 h-8 rounded-lg border border-border bg-card hover:bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">
                  {state.source ? repoName : <a href={state.issueUrl} target="_blank" rel="noreferrer" className="hover:underline">{repoName} #{state.issueNumber}</a>}
                </p>
                <h1 className="text-base sm:text-lg font-bold text-foreground leading-snug line-clamp-2">{state.title}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={meta.tone} dot className="tabular-nums">
                {meta.label}{elapsed ? ` · ${elapsed}` : ''}
              </Badge>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mr-auto" title="Model spend for this task (hard-capped)">
              <span className="tabular-nums">${state.costUsd.toFixed(4)}</span>
              <span className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                <span className={cn('block h-full rounded-full', costPct > 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${costPct}%` }} />
              </span>
              <span className="tabular-nums">of ${state.capUsd.toFixed(2)} cap · {state.llmCalls} model calls</span>
              {state.statusDetail && <span className="hidden md:inline truncate max-w-[320px]">· {state.statusDetail}</span>}
            </div>
            {meta.active && (
              <Button size="sm" variant="secondary" loading={busy === 'cancel'} onClick={() => act('cancel', () => cancelTask(taskId), 'Cancelling…')}>
                <Square className="w-3 h-3" /> Stop
              </Button>
            )}
            {(status === 'failed' || status === 'cancelled') && (
              <Button size="sm" variant="secondary" loading={busy === 'retry'} onClick={() => act('retry', () => retryTask(taskId), 'Retrying from scratch')}>
                <RotateCcw className="w-3.5 h-3.5" /> Retry
              </Button>
            )}
            {terminal && !state.source && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === 'share'}
                onClick={() => act('share', async () => setIsPublic((await shareTask(taskId, !isPublic)).isPublic), isPublic ? 'Replay is private' : 'Public replay link enabled')}
              >
                <Globe className="w-3.5 h-3.5" /> {isPublic ? 'Unshare' : 'Share replay'}
              </Button>
            )}
            {isPublic && (
              <a href={`/r/${taskId}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">/r/{taskId.slice(0, 8)}</a>
            )}
            {state.prUrl && (
              <a href={state.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-foreground bg-primary px-3 py-1.5 rounded-button hover:brightness-95">
                <ExternalLink className="w-3.5 h-3.5" /> View PR
              </a>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* Sidebar */}
          <aside className="md:w-[270px] shrink-0 min-w-0 [overflow-wrap:anywhere] md:overflow-x-hidden border-b md:border-b-0 md:border-r border-border bg-muted/30 md:overflow-y-auto">
            <div className="px-4 py-3">
              <p className="text-sm font-semibold text-foreground mb-2">Checklist</p>
              {checklist.length === 0 ? (
                <p className="text-xs text-muted-foreground">{meta.active ? 'Waiting for the plan…' : 'No plan.'}</p>
              ) : (
                <ol className="space-y-1.5">
                  {checklist.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px]">
                      {s.status === 'completed' ? (
                        <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                      ) : s.status === 'in_progress' ? (
                        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                      )}
                      <span className={cn('min-w-0', s.status === 'completed' ? 'text-muted-foreground' : 'text-foreground')}>{s.title}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {state.plan?.requirements && state.plan.requirements.length > 0 && (
              <div className="px-4 py-3 border-t border-border hidden md:block">
                <p className="text-xs font-semibold text-foreground mb-1.5">Requirements</p>
                <ul className="space-y-1">
                  {state.plan.requirements.map((r, i) => {
                    const check = state.verdict?.requirements?.[i]
                    return (
                      <li key={i} className="text-[11.5px] text-muted-foreground flex gap-1.5">
                        <span className={cn('font-mono shrink-0 whitespace-nowrap [overflow-wrap:normal]', check ? (check.met ? 'text-success' : 'text-destructive') : 'text-primary')}>{check ? (check.met ? '✓' : '✗') : `R${i + 1}`}</span>
                        <span className="min-w-0">{r}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {state.checkpoints.length > 0 && reviewable && (
              <div className="px-4 py-3 border-t border-border hidden md:block">
                <p className="text-xs font-semibold text-foreground mb-1.5">Checkpoints</p>
                <ul className="space-y-1">
                  {state.checkpoints.slice(-6).reverse().map((c) => (
                    <li key={c.sha} className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <span className="font-mono">{c.label}</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        onClick={() => act(`restore-${c.sha}`, () => restoreCheckpoint(taskId, c.sha), `Restored ${c.label}`).then(loadDiff)}
                      >
                        <Undo2 className="w-3 h-3" /> restore
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          {/* Main */}
          <div className="flex-1 min-w-0 flex flex-col min-h-[420px]">
            <div className="shrink-0 px-3 sm:px-5 py-2.5 border-b border-border flex items-center justify-between gap-2">
              <Tabs<TabKey>
                layoutId="task-tabs"
                value={tab}
                onChange={setTab}
                items={[
                  { key: 'activity', label: 'Activity' },
                  { key: 'changes', label: 'Changes', ...(fileCount || patchFiles ? { count: fileCount || patchFiles } : {}) },
                  { key: 'review', label: 'Review' },
                ]}
              />
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {status === 'awaiting_approval' && state.plan && (
                <div className="shrink-0 p-3 sm:p-4 border-b border-border max-h-[70%] overflow-y-auto">
                  <PlanCard
                    key={JSON.stringify(state.plan.steps)}
                    taskId={taskId}
                    plan={state.plan}
                    intake={state.intake}
                    busy={busy === 'approve' || busy === 'replan'}
                    onApprove={(edited) => void act('approve', () => approvePlan(taskId, edited), 'Plan approved — the agent is starting')}
                    onReplan={(text) => void act('replan', () => replanTask(taskId, text), 'Re-planning with your choices')}
                    onCancel={() => void act('cancel', () => cancelTask(taskId), 'Task cancelled')}
                  />
                </div>
              )}
              {status === 'parked' && state.park && (
                <ParkedBanner
                  park={state.park}
                  busy={busy}
                  onResume={() => void act('resume', () => resumeTask(taskId), 'Resuming')}
                  onCancel={() => void act('cancel', () => cancelTask(taskId), 'Task cancelled')}
                />
              )}
              {status === 'needs_input' && state.pendingQuestion && (
                <div className="shrink-0 p-3 sm:p-4 border-b border-border bg-primary/5">
                  <p className="text-xs font-semibold text-primary mb-1">The agent needs your input</p>
                  <p className="text-[13px] text-foreground mb-2 whitespace-pre-wrap">{state.pendingQuestion}</p>
                  {state.intake?.attachments.length ? (
                    <div className="mb-2">
                      <Attachments taskId={taskId} intake={state.intake} />
                    </div>
                  ) : null}
                  <Composer autoFocus placeholder="Your answer…" onSend={(t) => act('answer', () => sendMessage(taskId, t), 'Answer sent — resuming')} />
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'activity' && <ActivityFeed events={events} live={meta.active} loading={!eventsLoaded} followKey={state.status} />}
                {tab === 'changes' && (
                  <div className="p-3 sm:p-5">
                    <DiffView
                      patch={patch}
                      rejected={state.rejectedFiles}
                      editable={reviewable}
                      onToggle={(p, r) => void act('reject', () => setFileRejected(taskId, p, r))}
                    />
                  </div>
                )}
                {tab === 'review' && (
                  <div className="p-3 sm:p-5">
                    <ReviewPanel state={state} />
                  </div>
                )}
              </div>

              {/* Action bar */}
              {reviewable && (
                <div className="shrink-0 border-t border-border p-3 sm:px-5 bg-muted/30 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12.5px] text-muted-foreground">
                      {state.stoppedEarly
                        ? `Stopped early (${state.stoppedByBudget ? `$${state.capUsd.toFixed(2)} budget` : 'step limit'}) with partial work — continue, or review what’s there.`
                        : status === 'ready' ? 'Validated and reviewed.' : 'Validation or review flagged something — check the Review tab.'} Publishing opens a{' '}
                      {state.options.draft ? 'draft ' : ''}pull request{state.rejectedFiles.length ? ` without ${state.rejectedFiles.length} excluded file(s)` : ''}.
                    </p>
                    <div className="flex items-center gap-2">
                      {state.stoppedEarly && (
                        <Button size="sm" variant="secondary" loading={busy === 'extend'} onClick={() => act('extend', () => extendBudget(taskId, 0.1), 'Budget raised — continuing')}>
                          Continue (+$0.10)
                        </Button>
                      )}
                      {!state.source && (
                        <Button size="sm" loading={busy === 'publish'} onClick={() => act('publish', () => publishTask(taskId), 'Opening the pull request…')}>
                          <GitPullRequest className="w-3.5 h-3.5" /> Publish PR
                        </Button>
                      )}
                    </div>
                  </div>
                  <Composer placeholder="Ask for changes (e.g. “also add a test for the empty case”)" onSend={(t) => act('feedback', () => sendMessage(taskId, t), 'Sent — the agent is revising')} />
                </div>
              )}
              {(status === 'running' || status === 'validating') && (
                <div className="shrink-0 border-t border-border p-3 sm:px-5">
                  <Composer placeholder="Send a note to the agent while it works…" onSend={(t) => act('note', () => sendMessage(taskId, t), 'Delivered on the agent’s next step')} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
