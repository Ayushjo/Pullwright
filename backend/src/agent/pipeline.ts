import path from "path"
import { appendFile, mkdir, rm } from "fs/promises"
import { existsSync } from "fs"
import type { EventBus } from "../events/eventBus.js"
import type { TaskEvent, TaskMetricsSnapshot } from "../events/types.js"
import logger from "../logger.js"
import { AgentLoop, type LoopEvent } from "./loop.js"
import type { ModelSpec } from "./llm.js"
import { getSpendLedger, SpendLimitError } from "./spend.js"
import { Workspace } from "./workspace.js"
import { Sandbox } from "./sandbox.js"
import { buildRepoMap } from "./repoMap.js"
import { detectRepoConfig } from "./repoConfig.js"
import { planTools, runTools } from "./tools/index.js"
import { PLAN_SYSTEM, RUN_SYSTEM, planTaskMessage, runTaskMessage } from "./prompts.js"
import { runGate, runVerify, gateFeedback, revertSideEffects } from "./gate.js"
import { judgePatch } from "./judge.js"
import { groundIssue, groundingNote } from "./grounding.js"
import { checkpoint, cloneForTask, cloneLocal, diffStat, diffVs, fetchIssue, git, publishPatch, redact, tasksRoot } from "./git.js"
import { taskStore, type TaskState, type TaskStatus } from "./store.js"
import { loadKey } from "../billing/index.js"

export type StageName = "plan" | "run" | "publish"
export type Enqueue = (stage: StageName, taskId: string) => Promise<void>
export type StatusSink = (s: TaskState) => Promise<void>

function spec(role: "plan" | "run" | "judge", override?: string): ModelSpec {
  const env = { plan: process.env.PW_PLAN_MODEL, run: process.env.PW_RUN_MODEL, judge: process.env.PW_JUDGE_MODEL }[role]
  const model = override && role !== "judge" ? override : (env ?? "gpt-5-mini")
  const effort = (process.env[`PW_${role.toUpperCase()}_EFFORT`] as ModelSpec["reasoningEffort"]) ?? "low"
  return { provider: "openai", model, reasoningEffort: effort }
}

/** The model spec for a task, paid with the user's own key (BYOK) when the task was created that way. */
async function modelSpec(s: TaskState, role: "plan" | "run" | "judge"): Promise<ModelSpec> {
  const base = spec(role, s.options.model)
  if (s.options.keyKind !== "byok" || !s.userId || !s.options.keyProvider) return base
  const k = await loadKey(s.userId, s.options.keyProvider)
  if (!k) throw new Error("Your API key was removed — add it again in Settings and retry.")
  const model = k.model || base.model
  return {
    ...base,
    provider: s.options.keyProvider,
    apiKey: k.key,
    model: s.options.keyProvider === "openrouter" && !model.includes("/") ? `openai/${model}` : model,
  }
}

const LIMITS = {
  plan: { maxSteps: Number(process.env.PW_PLAN_MAX_STEPS ?? 20), maxWallMs: 8 * 60_000, maxFormatErrors: 3, maxOutputTokens: 6_000 },
  run: { maxSteps: Number(process.env.PW_RUN_MAX_STEPS ?? 40), maxWallMs: 18 * 60_000, maxFormatErrors: 3, maxOutputTokens: 10_000 },
}

const EXCLUDES = ["node_modules/", "__pycache__/", ".venv/", "*.pyc", ".npm/", ".pytest_cache/", ".cache/", "coverage/"]

export class Pipeline {
  constructor(
    private bus: EventBus,
    private enqueue: Enqueue,
    private onStatus: StatusSink,
  ) {}

  private emit(taskId: string, e: TaskEvent) {
    return this.bus.emit(taskId, e).catch((err) => logger.warn(`emit failed: ${err}`))
  }

  private async setStatus(s: TaskState, status: TaskStatus, detail?: string, extra: Partial<TaskState> = {}) {
    const next = await taskStore.put({ ...s, ...extra, status, ...(detail !== undefined ? { statusDetail: detail } : {}) })
    Object.assign(s, next)
    await this.emit(s.taskId, { type: "status", status, ...(detail ? { detail } : {}) })
    await this.onStatus(next).catch((e) => logger.warn(`status sink failed: ${e}`))
    return next
  }

  private loopEvents(s: TaskState, phase: "plan" | "run") {
    const ledger = getSpendLedger()
    return (e: LoopEvent) => {
      if (e.type === "llm_call") {
        s.llmCalls++
        s.costUsd = ledger.taskSpent(s.taskId)
        s.inputTokens = (s.inputTokens ?? 0) + e.inputTokens
        s.cachedInputTokens = (s.cachedInputTokens ?? 0) + e.cachedInputTokens
        s.outputTokens = (s.outputTokens ?? 0) + e.outputTokens
        void this.emit(s.taskId, {
          type: "llm_call",
          agent: phase === "plan" ? "planner" : "executor",
          model: e.model,
          provider: "openai",
          tokens: { in: e.inputTokens, out: e.outputTokens, cached: e.cachedInputTokens },
          costUsd: e.costUsd,
          durationMs: e.durationMs,
        })
        void this.emit(s.taskId, { type: "cost", costUsd: s.costUsd, llmCalls: s.llmCalls, capUsd: ledger.taskCapUsd })
        void taskStore.patchCounters(s.taskId, { costUsd: s.costUsd, llmCalls: s.llmCalls, toolCalls: s.toolCalls })
      } else if (e.type === "agent_thought") {
        void this.emit(s.taskId, { type: "agent_thought", agent: phase === "plan" ? "planner" : "executor", status: "reasoning", text: e.text })
      } else if (e.type === "tool_call") {
        s.toolCalls++
        void this.emit(s.taskId, { type: "tool_call", tool: e.tool, args: e.args })
      } else if (e.type === "tool_result") {
        void this.emit(s.taskId, { type: "tool_result", tool: e.tool, success: e.success, output: e.output, durationMs: e.durationMs })
      } else if (e.type === "notice") {
        void this.emit(s.taskId, { type: "notice", level: e.level, message: e.message })
      }
    }
  }

  private workspace(s: TaskState) {
    if (!s.workDir) throw new Error("Workspace missing — the task must be re-planned")
    return new Workspace(s.workDir)
  }

  private async fail(s: TaskState, reason: string) {
    const clean = redact(reason)
    logger.error(`Task ${s.taskId} failed: ${clean}`)
    await this.setStatus(s, "failed", clean, { failureReason: clean, finishedAt: new Date().toISOString() })
    await this.emit(s.taskId, { type: "task_failed", reason: clean, metrics: metricsOf(s) })
    await taskStore.dropToken(s.taskId)
  }

  // ── Stage 1: prepare + plan ────────────────────────────────────────────────
  async plan(taskId: string) {
    const s = await taskStore.get(taskId)
    if (!s) throw new Error(`Unknown task ${taskId}`)
    let sb: Sandbox | null = null
    try {
      const replanning = Boolean(s.workDir && existsSync(s.workDir) && s.planMessage && s.baseSha)
      if (!replanning) {
      await this.setStatus(s, "preparing", "Fetching issue and cloning repository", { startedAt: s.startedAt ?? new Date().toISOString() })
      const workDir = path.join(tasksRoot(), taskId, "repo")
      let baseSha: string
      let issue: { title: string; body: string; comments: string[]; defaultBranch: string }
      if (s.source?.kind === "local") {
        const c = await cloneLocal(s.source.repoPath, workDir)
        baseSha = c.baseSha
        issue = { title: s.title, body: s.body, comments: s.comments, defaultBranch: c.branch }
        s.defaultBranch = c.branch
      } else {
        const token = await taskStore.getToken(taskId)
        const ref = { owner: s.owner, repo: s.repo, issueNumber: s.issueNumber }
        issue = await fetchIssue(ref, token)
        Object.assign(s, { title: issue.title, body: issue.body, comments: issue.comments, defaultBranch: issue.defaultBranch })
        await taskStore.put(s)
        baseSha = await cloneForTask(ref, issue.defaultBranch, workDir, token)
      }
      await mkdir(path.join(workDir, ".git", "info"), { recursive: true })
      await appendFile(path.join(workDir, ".git", "info", "exclude"), "\n" + EXCLUDES.join("\n") + "\n")
      s.workDir = workDir
      s.baseSha = baseSha
      const cfg = await detectRepoConfig(new Workspace(workDir))
      s.setupCmds = cfg.setup
      s.verifyCmds = cfg.verify
      s.instructions = cfg.instructions
      await taskStore.put(s)

      // Setup (network on) + baseline verification on the untouched base commit.
      if (cfg.setup.length || cfg.verify.length) {
        await this.setStatus(s, "preparing", cfg.setup.length ? "Installing dependencies in the sandbox" : "Running baseline checks")
        sb = await Sandbox.create(taskId, workDir, { network: true, memoryMb: 2048, cpus: 2 })
        for (const cmd of cfg.setup) {
          const r = await sb.exec(cmd, 600_000)
          await this.emit(taskId, { type: "tool_result", tool: "setup", success: r.exitCode === 0, output: `$ ${cmd}\n${r.stdout.slice(-1500)}`, durationMs: r.durationMs })
        }
        // Setup must not leak into the diff: restore tracked files it touched, ignore new ones.
        const dirty = (await git(workDir, ["status", "--porcelain"])).split("\n").filter(Boolean)
        const modified = dirty.filter((l) => l.startsWith(" M")).map((l) => l.slice(3))
        const untracked = dirty.filter((l) => l.startsWith("??")).map((l) => l.slice(3))
        if (modified.length) await git(workDir, ["checkout", "--", ...modified])
        if (untracked.length) await appendFile(path.join(workDir, ".git", "info", "exclude"), untracked.join("\n") + "\n")
        await sb.destroy()
        sb = null
        // Baseline under the same conditions as validation later (no network).
        if (cfg.verify.length) {
          sb = await Sandbox.create(taskId, workDir, { network: false })
          s.baseline = await runVerify(sb, cfg.verify)
          await sb.destroy()
          sb = null
          await revertSideEffects(workDir, baseSha, [])
        }
      }

      await this.setStatus(s, "planning", "Reading the code and drafting a plan")
      const map = await buildRepoMap(new Workspace(workDir), `${issue.title}\n${issue.body}\n${issue.comments.join("\n")}`)
      const grounding = await groundIssue(new Workspace(workDir), `${issue.title}\n${issue.body}`)
      if (grounding.missingPaths.length || grounding.missingSymbols.length) {
        await this.emit(taskId, { type: "notice", level: "warn", message: `Issue mentions things not found in the repo: ${[...grounding.missingPaths, ...grounding.missingSymbols].join(", ")}` })
      }
      s.planMessage = planTaskMessage({
        repo: `${s.owner}/${s.repo}`,
        issueNumber: s.issueNumber,
        title: issue.title,
        body: issue.body,
        comments: issue.comments,
        repoMap: map.text,
        instructions: [cfg.instructions, groundingNote(grounding)].filter(Boolean).join("\n\n"),
        verifyCommands: cfg.verify.map((c) => {
          const b = s.baseline?.find((x) => x.cmd === c)
          return b ? `${c}   (currently ${b.exitCode === 0 ? "passing" : `FAILING, exit ${b.exitCode}`})` : c
        }),
      })
      await taskStore.put(s)
      }
      const ws = new Workspace(s.workDir!)

      sb = await Sandbox.create(taskId, ws.root, { network: false, readOnlyWorkspace: true })
      const loop = new AgentLoop(taskId, "plan", await modelSpec(s, "plan"), PLAN_SYSTEM, s.planMessage!, planTools(ws, sb), LIMITS.plan, {
        emit: this.loopEvents(s, "plan"),
        isCancelled: () => taskStore.isCancelled(taskId),
      })
      const out = await loop.run()
      await sb.destroy()
      sb = null
      await taskStore.put(s)

      if (out.status === "cancelled") return this.cancelled(s)
      if (out.status !== "plan") return this.fail(s, out.status === "failed" ? out.reason : "Planner did not produce a plan")
      const plan = out.control.plan
      s.plan = plan
      s.planChecklist = plan.steps.map((st) => ({ title: st.title, status: "pending" }))
      await this.emit(taskId, { type: "plan_ready", plan })
      if (plan.blocked) {
        if (s.options.autoApprove) return this.fail(s, `Needs clarification: ${plan.blocked}`)
        await this.setStatus(s, "needs_input", plan.blocked, { pendingQuestion: plan.blocked })
        await this.emit(taskId, { type: "question", question: plan.blocked })
        return
      }
      if (s.options.autoApprove) {
        await this.setStatus(s, "running", "Plan auto-approved")
        await this.enqueue("run", taskId)
      } else {
        await this.setStatus(s, "awaiting_approval", "Review the plan and approve it to start")
      }
    } catch (err) {
      if (sb) await sb.destroy()
      if (err instanceof SpendLimitError) return this.fail(s, `Budget cap reached: ${err.message}`)
      return this.fail(s, (err as Error).message)
    }
  }

  // ── Stage 2: implement + validate + judge ─────────────────────────────────
  async run(taskId: string) {
    const s = await taskStore.get(taskId)
    if (!s) throw new Error(`Unknown task ${taskId}`)
    if (!s.plan || !s.planMessage) return this.fail(s, "No approved plan")
    let sb: Sandbox | null = null
    try {
      const ws = this.workspace(s)
      await this.setStatus(s, "running", "Implementing the plan")
      sb = await Sandbox.create(taskId, ws.root, { network: false })
      const sandbox = sb
      let gateAttempts = 0
      let judgeRounds = 0
      const review = async (patch: string) => {
        try {
          const verifyText = (s.gate?.verify ?? [])
            .map((v) => `${v.cmd}: exit before=${v.before ?? "n/a"} after=${v.after}` + (v.newFailures.length ? `; NEW failures: ${v.newFailures.join("; ")}` : "; no new test failures") + (v.fixed.length ? `; now passing: ${v.fixed.join("; ")}` : ""))
            .join("\n") + (s.gate?.impact?.length ? `\nOther code that calls the changed routes (not in the patch):\n${s.gate.impact.join("\n")}` : "")
          const v = await judgePatch(await modelSpec(s, "judge"), taskId, {
            title: s.title,
            body: s.body,
            plan: planText,
            requirements: s.plan!.requirements ?? [],
            summary: s.summary ?? "",
            patch,
            verify: verifyText,
          }, (u) => this.loopEvents(s, "run")({ type: "llm_call", purpose: "judge", ...u }))
          await this.emit(taskId, { type: "judge_result", ...v })
          return v
        } catch (err) {
          logger.warn(`judge failed: ${(err as Error).message}`)
          return null
        }
      }
      const unplannedSeen = new Set<string>()
      const impactSeen = new Set<string>()
      let forcedReview = false
      const plannedFiles = s.plan.files.map((f) => f.path)
      const planText = [
        s.plan.editedByUser
          ? "The user edited this plan at approval time: the steps and requirements below are authoritative; ignore anything in the original summary that contradicts them."
          : s.plan.summary,
        ...s.plan.steps.map((x, i) => `${i + 1}. ${x.title}`),
        ...(s.plan.userNotes?.length ? [`User notes: ${s.plan.userNotes.join(" | ")}`] : []),
      ].join("\n")
      let stepNo = s.checkpoints.length

      const loop = new AgentLoop(
        taskId,
        "run",
        await modelSpec(s, "run"),
        RUN_SYSTEM,
        runTaskMessage(s.planMessage, s.plan),
        runTools(ws, sandbox, (steps) => {
          s.planChecklist = steps
          void this.emit(taskId, { type: "plan_update", steps })
        }),
        {
          ...LIMITS.run,
          // Bigger plans get more steps; the per-task dollar cap remains the hard guard.
          maxSteps: Math.min(80, Math.max(LIMITS.run.maxSteps, 25 + 8 * plannedFiles.length)),
          maxWallMs: Math.min(30 * 60_000, LIMITS.run.maxWallMs + plannedFiles.length * 60_000),
        },
        {
          emit: this.loopEvents(s, "run"),
          isCancelled: () => taskStore.isCancelled(taskId),
          pollUserMessages: async () => {
            const msgs = await taskStore.drainMessages(taskId)
            for (const m of msgs) await this.emit(taskId, { type: "user_message", text: m })
            return msgs
          },
          onMutation: () => {
            stepNo++
            void checkpoint(ws.root, taskId, `edit-${stepNo}`, s.baseSha!)
              .then((sha) => {
                s.checkpoints.push({ label: `edit-${stepNo}`, sha, at: new Date().toISOString() })
                if (s.checkpoints.length > 40) s.checkpoints.shift()
                return this.emit(taskId, { type: "checkpoint", label: `edit-${stepNo}`, sha })
              })
              .catch(() => {})
          },
          onFinish: async (summary) => {
            gateAttempts++
            await this.setStatus(s, "validating", `Validating the change (attempt ${gateAttempts})`)
            const g = await runGate({ ws, sb: sandbox, baseSha: s.baseSha!, plannedFiles, planText, verifyCmds: s.verifyCmds ?? [], baseline: s.baseline ?? [], unplannedSeen, impactSeen })
            s.gate = { ok: g.ok, problems: g.problems, warnings: g.warnings, verify: g.verify, ...(g.impact ? { impact: g.impact } : {}) }
            s.stats = g.stats
            await this.emit(taskId, { type: "gate_result", ok: g.ok, problems: g.problems, warnings: g.warnings, verify: g.verify.map((v) => ({ cmd: v.cmd, before: v.before, after: v.after })) })
            s.summary = summary
            if (g.ok) {
              // Independent reviewer: checks every requirement against the patch. One fix round on failure.
              const patch = await diffVs(ws.root, s.baseSha!)
              const v = await review(patch)
              if (!v) return null
              s.verdict = v
              if (v.success || judgeRounds >= 1) return null
              const remaining = getSpendLedger().taskCapUsd - getSpendLedger().taskSpent(taskId)
              if (remaining < 0.03) return null
              judgeRounds++
              await this.setStatus(s, "running", "Addressing reviewer findings")
              return (
                `An independent reviewer checked your patch against the requirements and found problems:\n` +
                v.concerns.map((c) => `- ${c}`).join("\n") +
                `\n\nFix them. If you are sure a finding is wrong, explain why in your finish summary. Then call finish again.`
              )
            }
            if (gateAttempts >= 3 || (g.problems.length === 1 && g.problems[0]!.startsWith("The diff is empty") && gateAttempts >= 2)) {
              forcedReview = true
              return null
            }
            await this.setStatus(s, "running", "Fixing validation findings")
            return gateFeedback(g)
          },
        },
        s.runMessages,
      )

      let out = await loop.run()
      // Autonomous mode: nobody can answer — tell the agent to proceed on its best assumption (once).
      if (out.status === "ask_user" && s.options.autoApprove) {
        await this.emit(taskId, { type: "question", question: out.question })
        loop.addUserMessage("No human is available to answer. Make the most reasonable assumption, state it in your finish summary, and continue.")
        out = await loop.run()
      }
      s.runMessages = loop.messages
      await sb.destroy()
      sb = null

      if (out.status === "cancelled") return this.cancelled(s)
      if (out.status === "ask_user") {
        await this.setStatus(s, "needs_input", out.question, { pendingQuestion: out.question })
        await this.emit(taskId, { type: "question", question: out.question })
        return
      }
      if (out.status === "failed") {
        // Keep partial work reviewable if there is any.
        const stats = await diffStat(ws.root, s.baseSha!).catch(() => [])
        if (stats.length === 0) return this.fail(s, out.reason)
        forcedReview = true
        s.summary = `Stopped early: ${out.reason}`
      }

      await revertSideEffects(ws.root, s.baseSha!, plannedFiles)
      const patch = await diffVs(ws.root, s.baseSha!)
      await taskStore.savePatch(taskId, patch)
      s.stats = await diffStat(ws.root, s.baseSha!)
      await this.emit(taskId, { type: "diff_ready", files: s.stats })

      if (!patch.trim()) return this.fail(s, "The agent finished without changing any files")

      // Independent review if the finish path didn't already produce a verdict (e.g. forced review).
      if (!s.verdict) {
        const v = await review(patch)
        if (v) s.verdict = v
      }
      const good = !forcedReview && (s.gate?.ok ?? false) && (s.verdict?.success ?? false)
      s.costUsd = getSpendLedger().taskSpent(taskId)
      if (good && s.options.autoPublish) {
        await this.setStatus(s, "ready", "Validated — publishing")
        await this.enqueue("publish", taskId)
      } else {
        await this.setStatus(s, good ? "ready" : "needs_review", good ? "Validated — review the diff and publish" : "Needs human review before publishing")
      }
    } catch (err) {
      if (sb) await sb.destroy()
      if (err instanceof SpendLimitError) return this.fail(s, `Budget cap reached: ${err.message}`)
      return this.fail(s, (err as Error).message)
    }
  }

  // ── Stage 3: publish ──────────────────────────────────────────────────────
  async publish(taskId: string) {
    const s = await taskStore.get(taskId)
    if (!s) throw new Error(`Unknown task ${taskId}`)
    try {
      if (s.source?.kind === "local") return this.fail(s, "Eval tasks on local repositories cannot be published")
      await this.setStatus(s, "publishing", "Opening the pull request")
      let patch = (await taskStore.loadPatch(taskId)) ?? ""
      if (s.rejectedFiles.length) patch = filterPatch(patch, new Set(s.rejectedFiles))
      if (!patch.trim()) return this.fail(s, "Nothing to publish (all files rejected or empty patch)")
      const token = await taskStore.getToken(taskId)
      const title = prTitle(s)
      const res = await publishPatch({
        ref: { owner: s.owner, repo: s.repo, issueNumber: s.issueNumber },
        ...(token ? { token } : {}),
        baseBranch: s.defaultBranch ?? "main",
        baseSha: s.baseSha!,
        patch,
        title,
        body: prBody(s),
        draft: s.options.draft,
        workDir: path.join(tasksRoot(), taskId, "publish"),
      })
      s.costUsd = getSpendLedger().taskSpent(taskId)
      await this.setStatus(s, "published", res.prUrl, { prUrl: res.prUrl, prBranch: res.branch, finishedAt: new Date().toISOString() })
      await this.emit(taskId, { type: "pr_opened", prUrl: res.prUrl })
      await this.emit(taskId, { type: "task_complete", prUrl: res.prUrl, metrics: metricsOf(s) })
      await taskStore.dropToken(taskId)
      await rm(path.join(tasksRoot(), taskId), { recursive: true, force: true }).catch(() => {})
    } catch (err) {
      return this.fail(s, (err as Error).message)
    }
  }

  private async cancelled(s: TaskState) {
    await this.setStatus(s, "cancelled", "Cancelled by user", { finishedAt: new Date().toISOString() })
    await this.emit(s.taskId, { type: "task_failed", reason: "Cancelled", metrics: metricsOf(s) })
    await taskStore.dropToken(s.taskId)
    await Sandbox.reapAll(s.taskId).catch(() => 0)
  }
}

export function metricsOf(s: TaskState): TaskMetricsSnapshot {
  const cap = getSpendLedger().taskCapUsd
  const cost = Math.max(s.costUsd, getSpendLedger().taskSpent(s.taskId))
  const start = s.startedAt ? Date.parse(s.startedAt) : Date.parse(s.createdAt)
  const end = s.finishedAt ? Date.parse(s.finishedAt) : Date.now()
  return {
    inputTokens: s.inputTokens ?? 0,
    outputTokens: s.outputTokens ?? 0,
    costUsd: cost,
    shadowCostUsd: cost,
    llmCalls: s.llmCalls,
    toolCalls: s.toolCalls,
    retries: 0,
    durationMs: Math.max(0, end - start),
    phases: {},
    budgetUsedUsd: cost,
    budgetLimitUsd: cap,
    budgetRemainingUsd: Math.max(0, cap - cost),
  }
}

/** Drop whole-file sections for rejected paths from a git patch. */
export function filterPatch(patch: string, rejected: Set<string>): string {
  const parts = patch.split(/^(?=diff --git )/m)
  return parts
    .filter((p) => {
      const m = p.match(/^diff --git a\/(.+?) b\/(.+?)\n/)
      return !m || (!rejected.has(m[1]!) && !rejected.has(m[2]!))
    })
    .join("")
}

function prTitle(s: TaskState): string {
  const t = s.title.trim().replace(/\s+/g, " ")
  if (/^(feat|fix|chore|docs|refactor|test|perf|build|ci|style)(\(.+\))?!?:/i.test(t)) return t.slice(0, 100)
  const isFeature = /\b(add|support|implement|introduce|new|allow|enable|create)\b/i.test(t) && !/\b(bug|fix|error|crash|broken|wrong|incorrect|fails?)\b/i.test(t)
  const isDocs = /\b(readme|docs?|documentation)\b/i.test(t) && (s.stats ?? []).every((f) => /\.(md|mdx|txt)$/.test(f.path))
  const type = isDocs ? "docs" : isFeature ? "feat" : "fix"
  return `${type}: ${t.charAt(0).toLowerCase()}${t.slice(1)}`.slice(0, 100)
}

function prBody(s: TaskState): string {
  const files = (s.stats ?? [])
    .filter((f) => !s.rejectedFiles.includes(f.path))
    .map((f) => `| \`${f.path}\` | ${f.status} | +${f.added} / −${f.removed} |`)
  const verify = (s.gate?.verify ?? []).map((v) => `| \`${v.cmd}\` | ${v.before === null ? "n/a" : v.before === 0 ? "✅" : "❌"} | ${v.after === 0 ? "✅" : "❌"} |`)
  const cost = getSpendLedger().taskSpent(s.taskId)
  return [
    `Closes #${s.issueNumber}`,
    "",
    "## Summary",
    s.summary?.trim() || s.plan?.summary || "",
    s.verdict?.explanation ? `\n> **Automated review:** ${s.verdict.explanation}` : "",
    "",
    "## Changes",
    "| File | Status | Lines |",
    "|---|---|---|",
    ...files,
    verify.length ? "\n## Verification\n| Command | Before | After |\n|---|---|---|\n" + verify.join("\n") : "",
    s.gate?.warnings.length ? `\n<details><summary>Validation warnings</summary>\n\n- ${s.gate.warnings.join("\n- ")}\n</details>` : "",
    s.plan?.risks && !s.plan.editedByUser ? `\n**Assumptions / risks:** ${s.plan.risks}` : "",
    s.plan?.userNotes?.length ? `\n**Reviewer notes given to the agent:** ${s.plan.userNotes.join(" · ")}` : "",
    "",
    `---\n<sub>Opened by Pullwright after human review · ${s.llmCalls} model calls · $${cost.toFixed(4)} · plan → sandbox → validation → review</sub>`,
  ]
    .filter((l) => l !== undefined)
    .join("\n")
}
