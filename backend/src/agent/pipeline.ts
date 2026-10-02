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
import { buildRepoMap, outline } from "./repoMap.js"
import { chatVia, laneFromSpec, parseLanes, type ChatFn } from "../llm/lanes.js"
import { detectRepoConfig } from "./repoConfig.js"
import { cacheableInstall, depKey, restoreDeps, saveDeps } from "./depCache.js"
import { planTools, runTools } from "./tools/index.js"
import { PLAN_SYSTEM, RUN_SYSTEM, planTaskMessage, runTaskMessage } from "./prompts.js"
import { runGate, runVerify, gateFeedback, revertSideEffects } from "./gate.js"
import { judgePatch } from "./judge.js"
import { groundIssue, groundingNote } from "./grounding.js"
import { checkpoint, cloneForTask, cloneLocal, diffStat, diffVs, fetchIssue, git, publishPatch, redact, tasksRoot } from "./git.js"
import { taskStore, type TaskState, type TaskStatus } from "./store.js"
import { loadKey } from "../billing/index.js"
import type { ChatCompletionContentPart } from "openai/resources/chat/completions"
import type { UserContent } from "./llm.js"
import { dataUrl, downloadAttachments, extractAttachments, type AttachmentRef } from "./intake/attachments.js"
import { attachmentsBlock, describeImages, type Described } from "./intake/describe.js"
import { specCheck, type SpecCheck } from "./intake/specCheck.js"
import { decide, formatQuestions, openQuestionsBlock } from "./intake/decide.js"
import { classifyTier } from "./tier.js"
import { PROVIDERS, supportsVision } from "../llm/registry.js"

export type StageName = "plan" | "run" | "publish"
export type Enqueue = (stage: StageName, taskId: string) => Promise<void>
export type StatusSink = (s: TaskState) => Promise<void>

export function spec(role: "plan" | "run" | "judge", override?: string): ModelSpec {
  const env = { plan: process.env.PW_PLAN_MODEL, run: process.env.PW_RUN_MODEL, judge: process.env.PW_JUDGE_MODEL }[role]
  const model = override && role !== "judge" ? override : (env ?? "gpt-5-mini")
  const effort = (process.env[`PW_${role.toUpperCase()}_EFFORT`] as ModelSpec["reasoningEffort"]) ?? "low"
  // PW_LLM_PROVIDER=vercel routes platform calls through Vercel AI Gateway (same OpenAI models,
  // paid from its free monthly credit); models are then addressed as vendor/model.
  const provider = (process.env.PW_LLM_PROVIDER as ModelSpec["provider"] | undefined) ?? "openai"
  const routed = provider === "vercel" && !model.includes("/") ? `openai/${model}` : model
  return { provider, model: routed, reasoningEffort: effort }
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

/**
 * The model calls for a role, routed through the gateway:
 * - the user's own key (BYOK) → only that key;
 * - an eval run pinned to a model (options.model) → only that model for plan/run (review stays default);
 * - otherwise the PW_LANES_<ROLE> list (e.g. "vercel:openai/gpt-5-mini,gemini:gemini-3.5-flash-lite"),
 *   or today's single configured model when no list is set.
 */
async function llmFor(s: TaskState, role: "plan" | "run" | "judge"): Promise<ChatFn> {
  const base = await modelSpec(s, role)
  if (base.apiKey) return chatVia([laneFromSpec(base, s.userId ?? null)])
  if (s.options.model && role !== "judge") return chatVia([laneFromSpec(base)])
  // Executors can be chosen per task size (PW_LANES_RUN_S / _M / _L), falling back to PW_LANES_RUN.
  const tier = role === "run" ? s.plan?.tier : undefined
  const tiered = tier ? parseLanes(process.env[`PW_LANES_RUN_${tier}`], base.reasoningEffort) : []
  const configured = tiered.length ? tiered : parseLanes(process.env[`PW_LANES_${role.toUpperCase()}`], base.reasoningEffort)
  return chatVia(configured.length ? configured : [laneFromSpec(base)])
}

/** Lanes that read issue images: measured vision models only; private repos skip lanes that train on data. */
const DEFAULT_VISION_LANES = "groq:qwen/qwen3.8-27b,gemini:gemini-3.5-flash-lite,vercel:openai/gpt-5-mini"
async function visionChat(s: TaskState): Promise<ChatFn | null> {
  const base = await modelSpec(s, "plan")
  if (base.apiKey) return supportsVision(base.provider, base.model) ? chatVia([laneFromSpec(base, s.userId ?? null)]) : null
  const lanes = parseLanes(process.env.PW_LANES_VISION ?? DEFAULT_VISION_LANES, "low").filter(
    (l) => supportsVision(l.provider, l.model) && (!s.repoPrivate || PROVIDERS[l.provider].dataPolicy[l.spendClass === "free" || l.spendClass === "free_credit" ? "free" : "paid"] === "no_train"),
  )
  return lanes.length ? chatVia(lanes) : null
}

export function taskCap(s: TaskState): number {
  const base = getSpendLedger().taskCapUsd
  if (s.options.capUsd) return s.options.capUsd
  const files = s.plan?.files.length ?? 0
  return Math.min(Number(process.env.TASK_BUDGET_MAX_USD ?? 0.3), base + Math.max(0, files - 3) * 0.015)
}

const LIMITS = {
  plan: { maxSteps: Number(process.env.PW_PLAN_MAX_STEPS ?? 20), maxWallMs: 8 * 60_000, maxFormatErrors: 3, maxOutputTokens: 6_000 },
  run: { maxSteps: Number(process.env.PW_RUN_MAX_STEPS ?? 40), maxWallMs: 18 * 60_000, maxFormatErrors: 3, maxOutputTokens: 10_000 },
}

const EXCLUDES = ["node_modules/", "__pycache__/", ".venv/", "*.pyc", ".npm/", ".pytest_cache/", ".cache/", "coverage/"]

/** The planner's first message: the plan message plus up to 4 issue images (text-only lanes get a note instead). */
async function planUser(s: TaskState): Promise<UserContent> {
  const images = (s.intake?.attachments ?? []).filter((a) => a.kind === "image" && a.file && !a.skipped).slice(0, 4)
  if (!images.length) return s.planMessage!
  const parts: ChatCompletionContentPart[] = [{ type: "text", text: s.planMessage! }]
  for (const a of images) {
    const url = await dataUrl(a).catch(() => null)
    if (url) parts.push({ type: "text", text: `Attachment ${a.n} (${a.where}):` }, { type: "image_url", image_url: { url } })
  }
  return parts.length > 1 ? parts : s.planMessage!
}

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
          provider: e.provider,
          tokens: { in: e.inputTokens, out: e.outputTokens, cached: e.cachedInputTokens },
          costUsd: e.costUsd,
          durationMs: e.durationMs,
        })
        void this.emit(s.taskId, { type: "cost", costUsd: s.costUsd, llmCalls: s.llmCalls, capUsd: taskCap(s) })
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
      let issue: { title: string; body: string; comments: string[]; defaultBranch: string; bodyHtml?: string; commentsHtml?: { body: string; html: string }[] }
      if (s.source?.kind === "local") {
        const c = await cloneLocal(s.source.repoPath, workDir)
        baseSha = c.baseSha
        issue = { title: s.title, body: s.body, comments: s.comments, defaultBranch: c.branch }
        s.defaultBranch = c.branch
      } else {
        const token = await githubToken(s)
        const ref = { owner: s.owner, repo: s.repo, issueNumber: s.issueNumber }
        const fetched = await fetchIssue(ref, token)
        issue = fetched
        Object.assign(s, { title: issue.title, body: issue.body, comments: issue.comments, defaultBranch: issue.defaultBranch, repoPrivate: fetched.isPrivate })
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
        if (cfg.setup.length) await this.installDeps(s, workDir, cfg.setup, false)
        // Baseline under the same conditions as validation later (no network).
        if (cfg.verify.length) {
          sb = await Sandbox.create(taskId, workDir, { network: false })
          await this.emit(taskId, { type: "status", status: "preparing", detail: "Running the project's tests on the unchanged code (baseline)" })
          // One command at a time so each result lands right after its call in the activity feed.
          s.baseline = []
          for (const cmd of cfg.verify) {
            await this.emit(taskId, { type: "tool_call", tool: "baseline", args: { command: cmd } })
            const [b] = await runVerify(sb, [cmd])
            if (!b) continue
            s.baseline.push(b)
            await this.emit(taskId, { type: "tool_result", tool: "baseline", success: b.exitCode === 0, output: `$ ${b.cmd}\n${b.exitCode === 0 ? "passes" : `already failing (exit ${b.exitCode})${b.failures.length ? ": " + b.failures.slice(0, 5).join("; ") : ""}`}`, durationMs: b.durationMs })
          }
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
      const intake = await this.intake(s, issue, map.text, groundingNote(grounding))
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
        attachments: intake.attachmentsText,
        openQuestions: intake.openQuestions,
      })
      await taskStore.put(s)
      if (intake.ask) {
        // Work can't sensibly start: ask before the planner spends calls on a guess (the answer re-plans).
        if (s.options.autoApprove) return this.fail(s, `Needs clarification: ${intake.ask}`)
        await this.setStatus(s, "needs_input", intake.ask, { pendingQuestion: intake.ask })
        await this.emit(taskId, { type: "question", question: intake.ask })
        return
      }
      }
      const ws = new Workspace(s.workDir!)

      sb = await Sandbox.create(taskId, ws.root, { network: false, readOnlyWorkspace: true })
      const loop = new AgentLoop(taskId, "plan", await llmFor(s, "plan"), PLAN_SYSTEM, await planUser(s), planTools(ws, sb, s.baseline), { ...LIMITS.plan, taskCapUsd: taskCap(s) }, {
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
      const size = classifyTier(plan)
      plan.tier = size.tier
      plan.tierReason = size.reason
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

  /** Usage from intake calls (transcripts, spec check) shows in the feed and cost like planner calls. */
  private tracked(s: TaskState, chat: ChatFn): ChatFn {
    const sink = this.loopEvents(s, "plan")
    return (o) => chat({ ...o, onUsage: (u) => sink({ type: "llm_call", purpose: u.purpose, model: u.model, provider: u.provider, costUsd: u.costUsd, inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, durationMs: u.durationMs }) })
  }

  /**
   * Intake (docs/architecture/intake.md): attachments → transcripts → specification check → ask or plan.
   * Failures here never fail the task: without transcripts or a spec check it plans as before.
   */
  private async intake(
    s: TaskState,
    issue: { title: string; body: string; comments: string[]; bodyHtml?: string; commentsHtml?: { body: string; html: string }[] },
    repoMap: string,
    grounding: string,
  ): Promise<{ attachmentsText: string; openQuestions: string; ask?: string }> {
    const refs: AttachmentRef[] = extractAttachments(issue.body, issue.bodyHtml, "issue")
    issue.comments.forEach((c, i) => {
      const raw = issue.commentsHtml?.[i]
      refs.push(...extractAttachments(raw?.body ?? c, raw?.html, `comment ${i + 1}`, refs.length + 1))
    })
    let described: Described[] = []
    if (refs.length) {
      await this.setStatus(s, "planning", `Reading ${refs.length} attachment${refs.length === 1 ? "" : "s"}`)
      try {
        const atts = await downloadAttachments(refs, path.join(tasksRoot(), s.taskId, "attachments"), { local: s.source?.kind === "local" })
        const chat = atts.some((a) => a.kind === "image" && a.file) ? await visionChat(s) : null
        described = chat ? await describeImages(atts, issue, this.tracked(s, chat), s.taskId) : atts
        const read = described.filter((a) => a.description && !a.skipped).length
        const skipped = described.filter((a) => a.skipped)
        const noVision = !chat && atts.some((a) => a.kind === "image" && a.file)
        await this.emit(s.taskId, {
          type: "notice",
          level: skipped.length || noVision ? "warn" : "info",
          message: [
            read ? `Read ${read} attachment${read === 1 ? "" : "s"}` : "",
            noVision ? "no model that can read images is available — images are skipped" : "",
            ...skipped.map((a) => `attachment ${a.n}: ${a.skipped}`),
          ].filter(Boolean).join("; "),
        })
      } catch (err) {
        if (err instanceof SpendLimitError) throw err
        logger.warn(`attachments failed for ${s.taskId}: ${(err as Error).message}`)
      }
    }
    const attachmentsText = attachmentsBlock(described)

    let spec: SpecCheck | null = null
    if (process.env.PW_SPEC_CHECK !== "off") {
      try {
        spec = await specCheck({ title: issue.title, body: issue.body, comments: issue.comments, attachments: attachmentsText, grounding, repoMap }, this.tracked(s, await llmFor(s, "plan")), s.taskId)
      } catch (err) {
        if (err instanceof SpendLimitError) throw err
        logger.warn(`spec check failed for ${s.taskId}: ${(err as Error).message}`)
      }
    }
    const d = decide(spec)
    s.intake = { attachments: described, spec, decision: d.action }
    if (spec) {
      const label = ["clear", "mostly clear", "vague", "unclear"][spec.underspec]
      const n = spec.questions.length
      await this.emit(s.taskId, { type: "notice", level: spec.underspec >= 2 ? "warn" : "info", message: `Specification check: ${label} (${spec.underspec}/3)${n ? ` — ${n} open question${n === 1 ? "" : "s"}${d.action === "ask" ? " for you" : " for the planner to settle"}` : ""}` })
    }
    const questions = d.action === "ask" ? d.questions : d.open
    return {
      attachmentsText,
      openQuestions: openQuestionsBlock(questions),
      ...(d.action === "ask" ? { ask: formatQuestions(d.questions, d.reason) } : {}),
    }
  }

  /**
   * Run setup commands in a network-enabled sandbox, restoring node_modules from the dependency cache
   * when the lockfile is unchanged. `onlyMissing` re-installs just the package dirs whose node_modules
   * are gone (the janitor removes them from idle workspaces).
   */
  private async installDeps(s: TaskState, workDir: string, cmds: string[], onlyMissing: boolean) {
    const scope = s.source?.kind === "local" ? `local:${s.source.repoPath}` : `${s.owner}/${s.repo}`.toLowerCase()
    const todo = onlyMissing
      ? cmds.filter((c) => {
          const ci = cacheableInstall(c) ?? (/\b(npm (ci|install)|pnpm install|yarn install)\b/.test(c) ? { dir: c.match(/^cd (\S+) && /)?.[1] ?? "." } : null)
          return ci && !existsSync(path.join(workDir, ci.dir, "node_modules"))
        })
      : cmds
    if (!todo.length) return
    // A restored package dir still needs the non-install setup that follows it (e.g. prisma generate).
    const dirs = new Set(todo.map((c) => c.match(/^cd (\S+) && /)?.[1] ?? "."))
    const run = onlyMissing ? cmds.filter((c) => dirs.has(c.match(/^cd (\S+) && /)?.[1] ?? ".")) : cmds
    let sb: Sandbox | null = null
    try {
      for (const cmd of run) {
        await this.emit(s.taskId, { type: "tool_call", tool: "setup", args: { command: cmd } })
        const ci = cacheableInstall(cmd)
        const key = ci ? await depKey(scope, workDir, ci.dir, ci.install).catch(() => null) : null
        const t0 = Date.now()
        if (ci && key && (await restoreDeps(key, path.join(workDir, ci.dir)))) {
          await this.emit(s.taskId, { type: "tool_result", tool: "setup", success: true, output: `$ ${cmd}\nrestored node_modules from the dependency cache`, durationMs: Date.now() - t0 })
          continue
        }
        sb ??= await Sandbox.create(s.taskId, workDir, { network: true, memoryMb: 2048, cpus: 2 })
        const r = await sb.exec(cmd, 600_000)
        await this.emit(s.taskId, { type: "tool_result", tool: "setup", success: r.exitCode === 0, output: `$ ${cmd}\n${r.stdout.slice(-1500)}`, durationMs: r.durationMs })
        if (ci && key && r.exitCode === 0) await saveDeps(key, path.join(workDir, ci.dir), scope)
      }
    } finally {
      if (sb) await sb.destroy()
    }
    // Setup must not leak into the diff: restore tracked files it touched, ignore new ones.
    if (!onlyMissing) {
      const dirty = (await git(workDir, ["status", "--porcelain"])).split("\n").filter(Boolean)
      const modified = dirty.filter((l) => l.startsWith(" M")).map((l) => l.slice(3))
      const untracked = dirty.filter((l) => l.startsWith("??")).map((l) => l.slice(3))
      if (modified.length) await git(workDir, ["checkout", "--", ...modified])
      if (untracked.length) await appendFile(path.join(workDir, ".git", "info", "exclude"), untracked.join("\n") + "\n")
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
      // The janitor drops node_modules from idle workspaces; bring them back (cache first) before running.
      if (s.setupCmds?.length) await this.installDeps(s, ws.root, s.setupCmds, true)
      sb = await Sandbox.create(taskId, ws.root, { network: false })
      const sandbox = sb
      let gateAttempts = 0
      let judgeRounds = 0
      const review = async (patch: string) => {
        try {
          const verifyText = (s.gate?.verify ?? [])
            .map((v) => `${v.cmd}: exit before=${v.before ?? "n/a"} after=${v.after}` + (v.newFailures.length ? `; NEW failures: ${v.newFailures.join("; ")}` : "; no new test failures") + (v.fixed.length ? `; now passing: ${v.fixed.join("; ")}` : ""))
            .join("\n") + (s.gate?.impact?.length ? `\nOther code that calls the changed routes (not in the patch):\n${s.gate.impact.join("\n")}` : "")
          const v = await judgePatch(await llmFor(s, "judge"), taskId, {
            title: s.title,
            body: s.body,
            plan: [
              planText,
              s.plan!.assumptions?.length ? `Decisions made where the issue left room (check the patch follows them):\n${s.plan!.assumptions.map((a) => `- ${a.question} → ${a.chosen}`).join("\n")}` : "",
              attachmentsBlock(s.intake?.attachments ?? []),
            ].filter(Boolean).join("\n\n"),
            requirements: s.plan!.requirements ?? [],
            summary: s.summary ?? "",
            patch,
            verify: verifyText,
            capUsd: taskCap(s),
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
      const untouchedSeen = new Set<string>()
      let forcedReview = false
      let mainSummary = ""
      const plannedFiles = s.plan.files.map((f) => f.path)
      const planText = [
        s.plan.editedByUser
          ? "The user edited this plan at approval time: the steps and requirements below are authoritative; ignore anything in the original summary that contradicts them."
          : s.plan.summary,
        ...s.plan.steps.map((x, i) => `${i + 1}. ${x.title}`),
        ...(s.plan.userNotes?.length ? [`User notes: ${s.plan.userNotes.join(" | ")}`] : []),
      ].join("\n")
      let stepNo = s.checkpoints.length
      // The model rarely calls update_plan, so derive progress from edits: all of a step's files
      // edited → at least in progress; at the end, fully-edited steps count as done.
      const touched = new Set<string>()
      const syncChecklist = (final: boolean) => {
        const cl = s.planChecklist
        const steps = s.plan!.steps
        if (!cl || cl.length < steps.length) return
        let changed = false
        const full = steps.map((st) => st.files.length > 0 && st.files.every((f) => touched.has(f)))
        const latest = full.lastIndexOf(true)
        steps.forEach((st, i) => {
          if (!full[i]) return
          const cur = cl[i]!.status
          // Work has moved on to a later step → this one is done; the latest fully-edited step is in progress.
          const next = final || i < latest ? "completed" : cur === "pending" ? "in_progress" : cur
          if (next !== cur) {
            cl[i] = { ...cl[i]!, status: next }
            changed = true
          }
        })
        if (changed) void this.emit(taskId, { type: "plan_update", steps: cl })
      }

      const loop = new AgentLoop(
        taskId,
        "run",
        await llmFor(s, "run"),
        RUN_SYSTEM,
        runTaskMessage(s.planMessage, s.plan) + (s.runMessages ? "" : await plannedFilesContext(ws, plannedFiles)),
        runTools(ws, sandbox, (steps) => {
          s.planChecklist = mergeChecklist(s.plan!.steps, s.planChecklist, steps)
          void this.emit(taskId, { type: "plan_update", steps: s.planChecklist })
        }, s.baseline),
        {
          ...LIMITS.run,
          // Bigger plans get more steps; the per-task dollar cap remains the hard guard.
          maxSteps: Math.min(80, Math.max(LIMITS.run.maxSteps, 25 + 8 * plannedFiles.length)),
          maxWallMs: Math.min(30 * 60_000, LIMITS.run.maxWallMs + plannedFiles.length * 60_000),
          taskCapUsd: taskCap(s),
        },
        {
          emit: this.loopEvents(s, "run"),
          isCancelled: () => taskStore.isCancelled(taskId),
          // The API emits user_message when a message arrives; here we only consume the inbox.
          pollUserMessages: () => taskStore.drainMessages(taskId),
          onMutation: (files) => {
            for (const f of files) touched.add(f)
            syncChecklist(false)
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
            const g = await runGate({ ws, sb: sandbox, baseSha: s.baseSha!, plannedFiles, planText, verifyCmds: s.verifyCmds ?? [], baseline: s.baseline ?? [], unplannedSeen, impactSeen, untouchedSeen, planSteps: s.plan!.steps })
            s.gate = { ok: g.ok, problems: g.problems, warnings: g.warnings, verify: g.verify, ...(g.impact ? { impact: g.impact } : {}) }
            s.stats = g.stats
            await this.emit(taskId, { type: "gate_result", ok: g.ok, problems: g.problems, warnings: g.warnings, verify: g.verify.map((v) => ({ cmd: v.cmd, before: v.before, after: v.after })) })
            // A reviewer-round finish only describes the fix; keep the main summary and append it.
            s.summary = judgeRounds > 0 && mainSummary ? `${mainSummary}\n\nAfter review: ${summary}` : summary
            if (judgeRounds === 0) mainSummary = summary
            if (g.ok) {
              // Independent reviewer: checks every requirement against the patch. One fix round on failure.
              const patch = await diffVs(ws.root, s.baseSha!)
              const v = await review(patch)
              if (!v) return null
              s.verdict = v
              // In-context fix rounds after a rejection; anything still unmet goes to the fresh-context repair pass.
              if (v.success || judgeRounds >= Number(process.env.PW_JUDGE_ROUNDS ?? 1)) return null
              // The task's own cap (scaled by plan size, raised by Continue), not the global default.
              const remaining = taskCap(s) - (await getSpendLedger().taskSpentAsync(taskId))
              if (remaining < 0.03) return null
              judgeRounds++
              await this.setStatus(s, "running", "Addressing reviewer findings")
              return (
                `An independent reviewer checked your patch against the requirements and found problems:\n` +
                v.concerns.map((c) => `- ${c}`).join("\n") +
                `\n\nFix them. If you are sure a finding is wrong, explain why in your finish summary. Then call finish again.`
              )
            }
            const maxGateAttempts = 3 + Math.floor(plannedFiles.length / 4)
            if (gateAttempts >= maxGateAttempts || (g.problems.length === 1 && g.problems[0]!.startsWith("The diff is empty") && gateAttempts >= 2)) {
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

      // Focused repair pass: after a long run the model tends to skip the last big step even when the
      // reviewer points at it. A fresh, short loop that sees only the unmet requirements does much better.
      const unmet = s.verdict?.requirements?.filter((r) => !r.met) ?? []
      const left = taskCap(s) - (await getSpendLedger().taskSpentAsync(taskId))
      if (out.status === "finished" && !forcedReview && s.gate?.ok && s.verdict && !s.verdict.success && unmet.length && left >= 0.04) {
        await this.setStatus(s, "running", "Completing unmet requirements")
        await this.emit(taskId, { type: "notice", level: "info", message: `Focused repair pass for ${unmet.length} unmet requirement(s)` })
        const changed = (await diffStat(ws.root, s.baseSha!).catch(() => [])).map((f) => f.path)
        let repairGate = 0
        const repair = new AgentLoop(
          taskId,
          "repair",
          await llmFor(s, "run"),
          RUN_SYSTEM,
          repairMessage(s, unmet, changed) + (await plannedFilesContext(ws, changed)),
          runTools(ws, sandbox, () => {}, s.baseline),
          { ...LIMITS.run, maxSteps: 18, maxWallMs: 7 * 60_000, taskCapUsd: taskCap(s) },
          {
            emit: this.loopEvents(s, "run"),
            isCancelled: () => taskStore.isCancelled(taskId),
            onFinish: async (summary) => {
              repairGate++
              await this.setStatus(s, "validating", "Validating the repair")
              const g = await runGate({ ws, sb: sandbox, baseSha: s.baseSha!, plannedFiles, planText, verifyCmds: s.verifyCmds ?? [], baseline: s.baseline ?? [], unplannedSeen, impactSeen, untouchedSeen, planSteps: s.plan!.steps })
              s.gate = { ok: g.ok, problems: g.problems, warnings: g.warnings, verify: g.verify, ...(g.impact ? { impact: g.impact } : {}) }
              await this.emit(taskId, { type: "gate_result", ok: g.ok, problems: g.problems, warnings: g.warnings, verify: g.verify.map((v) => ({ cmd: v.cmd, before: v.before, after: v.after })) })
              if (!g.ok) {
                if (repairGate >= 2) return null
                await this.setStatus(s, "running", "Fixing validation findings")
                return gateFeedback(g)
              }
              s.summary = `${s.summary ?? ""}\n\nRepair pass: ${summary}`.trim()
              const v = await review(await diffVs(ws.root, s.baseSha!))
              if (v) s.verdict = v
              return null
            },
          },
        )
        const r = await repair.run()
        if (r.status === "cancelled") {
          await sb.destroy()
          sb = null
          return this.cancelled(s)
        }
        if (r.status === "failed") await this.emit(taskId, { type: "notice", level: "warn", message: `Repair pass stopped: ${r.reason}` })
        if (!s.gate?.ok) forcedReview = true
      }
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
      touched.clear()
      for (const f of s.stats) touched.add(f.path)
      if (out.status === "finished") syncChecklist(true)
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
      const token = await githubToken(s)
      if (!token) return this.fail(s, "Your GitHub sign-in for this task expired. Sign in again and click Publish.")
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
  const cap = taskCap(s)
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

type Check = { title: string; status: string }
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
function similar(a: string, b: string): number {
  const A = words(a)
  const B = words(b)
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.max(1, new Set([...A, ...B]).size)
}

/**
 * The approved plan's steps stay the checklist: the model's update_plan only moves statuses.
 * (Seen live: the agent rewrote a 6-step plan into 2 steps, which hid the remaining work from the UI.)
 * Incoming items are matched to approved steps by title (or by position when the counts agree);
 * items that match nothing are appended as extra steps.
 */
export function mergeChecklist(approved: { title: string }[], prev: Check[] | undefined, incoming: Check[]): Check[] {
  const out: Check[] = approved.map((st, i) => ({ title: st.title, status: prev?.[i]?.title === st.title ? prev[i]!.status : "pending" }))
  const extras: Check[] = []
  incoming.forEach((inc, j) => {
    let best = -1
    let score = 0.34
    out.forEach((st, i) => {
      const sc = similar(st.title, inc.title)
      if (sc > score) {
        score = sc
        best = i
      }
    })
    if (best < 0 && incoming.length === approved.length) best = j
    if (best >= 0) out[best]!.status = inc.status
    else if (!approved.length) extras.push(inc)
    else if (!extras.some((e) => e.title === inc.title)) extras.push(inc)
  })
  return [...out, ...extras.slice(0, 4)]
}

/**
 * The run starts with a fresh context, so without this it re-reads every file the planner already read.
 * Small planned files go in whole, big ones as an outline (line: declaration) for targeted views.
 */
async function plannedFilesContext(ws: Workspace, files: string[]): Promise<string> {
  const parts: string[] = []
  let budget = 40_000
  for (const f of files) {
    if (!ws.exists(f) || ws.isDir(f)) continue
    const content = await ws.read(f).catch(() => "")
    const lines = content.split("\n")
    const body =
      lines.length <= 150 && content.length <= 8_000 && content.length <= budget
        ? `### ${f} (${lines.length} lines, full)\n${lines.map((l, i) => `${String(i + 1).padStart(4)}\t${l}`).join("\n")}`
        : `### ${f} (${lines.length} lines — outline; view the ranges you need)\n${outline(f, content, 60) || "(no declarations found)"}`
    if (body.length > budget) break
    budget -= body.length
    parts.push(body)
  }
  return parts.length ? `\n\n## Planned files (current content — no need to re-read these in full)\n${parts.join("\n\n")}` : ""
}

/**
 * The task owner's GitHub token (refreshed on each of their actions). Only tasks without a user —
 * operator and eval runs — may fall back to the operator's GITHUB_TOKEN; a user's task never does.
 */
async function githubToken(s: TaskState): Promise<string | undefined> {
  return (await taskStore.getToken(s.taskId)) ?? (s.userId ? undefined : process.env.GITHUB_TOKEN)
}

function repairMessage(s: TaskState, unmet: { item: string; evidence: string }[], changed: string[]): string {
  return [
    `# Issue: ${s.title}`,
    s.body.slice(0, 3000),
    `\n## Status`,
    `Most of this issue is already implemented in the working tree (files changed so far: ${changed.join(", ") || "none"}).`,
    `An independent reviewer found these requirements NOT met:`,
    ...unmet.map((r) => `- ${r.item}\n  Reviewer: ${r.evidence || "(no detail)"}`),
    `\nYour only job is to complete exactly these requirements. View the relevant file sections first, then make the edits`,
    `(targeted apply_patch / str_replace; for a large UI piece, add it in a few medium-sized edits rather than one huge one).`,
    `Do not rework what is already done and do not touch unrelated files. Run the type-check/tests once, then call finish`,
    `with a short summary of what you added for each requirement.`,
  ].join("\n")
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
