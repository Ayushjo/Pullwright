import { randomUUID } from "crypto"
import { Router, type Request, type Response } from "express"
import { z } from "zod"
import path from "path"
import { existsSync } from "fs"
import rateLimit from "express-rate-limit"
import logger from "../logger.js"
import type { EventBus } from "../events/eventBus.js"
import type { TaskRegistry } from "../store/taskRegistry.js"
import type { EventLog } from "../events/eventLog.js"
import { requireAuth } from "./auth.js"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import { countActiveTasksForUser, getStatsForUser, listTasksForUser, userOwnsTask, getMetricsFromDb, getTaskDetailFromDb } from "../repositories/taskRepository.js"
import { RedisRateStore } from "./redisRateStore.js"
import { flushLlmCalls, listCallsForTask } from "../repositories/llmCallRepository.js"
import { createTask, enqueue } from "../agent/service.js"
import { taskStore, TERMINAL, type TaskState } from "../agent/store.js"
import { getSpendLedger } from "../agent/spend.js"
import { getEntitlement } from "../billing/index.js"
import { diffStat, diffVs, restoreCheckpoint, tasksRoot } from "../agent/git.js"
import { filterPatch, metricsOf, taskCap } from "../agent/pipeline.js"

const ISSUE_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+\/?$/

const CreateTask = z.object({
  issueUrl: z.string().trim().regex(ISSUE_URL, "Paste a GitHub issue URL like https://github.com/owner/repo/issues/12"),
  autoApprove: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  draft: z.boolean().optional(),
})
const LocalTask = z.object({
  localRepo: z.string().min(1).max(500),
  title: z.string().trim().min(3).max(300),
  body: z.string().max(20_000).default(""),
  autoApprove: z.boolean().optional(),
  /** Pin the planning/execution model for this eval run (the reviewer stays on the configured model). */
  model: z.string().trim().min(3).max(100).regex(/^[\w./:-]+$/).optional(),
})
const Approve = z.object({
  requirements: z.array(z.string().trim().min(3).max(500)).max(15).optional(),
  steps: z.array(z.object({ title: z.string().trim().min(3).max(300), files: z.array(z.string().max(300)).max(30) })).min(1).max(8).optional(),
  note: z.string().max(4000).optional(),
})
const Message = z.object({ text: z.string().trim().min(1).max(4000) })
const Replan = z.object({ text: z.string().trim().min(3).max(4000) })
const Reject = z.object({ path: z.string().min(1).max(500), rejected: z.boolean() })
const Restore = z.object({ sha: z.string().regex(/^[0-9a-f]{7,40}$/) })

/** Client-safe view of a task (no transcripts, paths or secrets). */
export function publicView(s: TaskState) {
  const { runMessages: _m, workDir: _w, planMessage: _p, instructions: _i, baseline, intake, ...rest } = s
  return {
    ...rest,
    // No server paths or (expired, but still signed) download URLs in the client view.
    ...(intake ? { intake: { ...intake, attachments: intake.attachments.map(({ file, fetchUrl: _f, ...a }) => ({ ...a, hasImage: Boolean(file) })) } } : {}),
    baseline: baseline?.map((b) => ({ cmd: b.cmd, exitCode: b.exitCode })),
    costUsd: Math.max(s.costUsd, getSpendLedger().taskSpent(s.taskId)),
    capUsd: taskCap(s),
    stoppedByBudget: /Budget cap reached/.test(`${s.summary ?? ""} ${s.failureReason ?? ""}`),
    stoppedEarly: /Stopped early|Budget cap reached|Step limit reached|Time limit reached/.test(`${s.summary ?? ""} ${s.failureReason ?? ""}`) && Boolean(s.runMessages?.length),
  }
}

export const createRouter = (eventBus: EventBus, taskRegistry: TaskRegistry, eventLog: EventLog) => {
  const router = Router()
  router.use(requireAuth)

  const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.TASKS_PER_HOUR ?? 12),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.userId ?? req.session?.login ?? "operator",
    message: { error: "Task limit reached for this hour — try again later." },
    store: new RedisRateStore("tasks"), // shared by every API replica
  })

  async function load(req: Request, res: Response): Promise<TaskState | null> {
    const taskId = String(req.params.taskId ?? "")
    const s = await taskStore.get(taskId)
    if (!s) {
      res.status(404).json({ error: "Task not found" })
      return null
    }
    if (!(await canAccess(req, s.taskId, s.userId))) {
      res.status(403).json({ error: "Forbidden" })
      return null
    }
    // The stored GitHub token expires after 24 h; every action by the task's owner refreshes it,
    // so a task approved or published days later still acts as that user (never as the operator).
    if (req.session?.accessToken && s.userId && req.session.userId === s.userId) {
      await taskStore.putToken(s.taskId, req.session.accessToken)
    }
    return s
  }

  /** Accounts listed in OPERATOR_GITHUB_LOGINS can see every task (incl. eval runs) in the UI. */
  const isOwner = (req: Request) => {
    const owners = (process.env.OPERATOR_GITHUB_LOGINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
    return Boolean(req.session?.login && owners.includes(req.session.login.toLowerCase()))
  }

  async function canAccess(req: Request, taskId: string, ownerId?: string): Promise<boolean> {
    if (req.isOperator || isOwner(req)) return true
    const uid = req.session?.userId
    if (!uid) return false
    if (ownerId) return ownerId === uid
    return isDatabaseEnabled() ? userOwnsTask(uid, taskId) : false
  }

  // Operator-only eval mode: run against a local git repo under EVAL_REPOS_DIR, never published.
  router.post("/eval/task", async (req, res) => {
    if (!req.isOperator) return res.status(403).json({ error: "Operator only" })
    const parsed = LocalTask.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" })
    const root = path.resolve(process.env.EVAL_REPOS_DIR ?? path.join(tasksRoot(), "eval-repos"))
    const repoPath = path.resolve(root, parsed.data.localRepo)
    if (!repoPath.startsWith(root + path.sep) || !existsSync(path.join(repoPath, ".git"))) {
      return res.status(400).json({ error: "localRepo must be a git repo inside EVAL_REPOS_DIR" })
    }
    const s = await createTask(
      {
        issueUrl: "",
        local: { repoPath, title: parsed.data.title, body: parsed.data.body },
        options: { autoApprove: parsed.data.autoApprove ?? true, autoPublish: false, draft: true, ...(parsed.data.model ? { model: parsed.data.model } : {}) },
      },
      taskRegistry,
    )
    res.status(201).json({ taskId: s.taskId, status: s.status })
  })

  router.post("/task", createLimiter, async (req, res) => {
    const parsed = CreateTask.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" })
    if (!req.isOperator && !req.session?.userId && isDatabaseEnabled()) {
      return res.status(401).json({ error: "Sign in again to create tasks" })
    }
    try {
      let keyChoice: { keyKind: "platform" | "byok"; keyProvider?: "openai" | "openrouter" } = { keyKind: "platform" }
      const owners = (process.env.OPERATOR_GITHUB_LOGINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
      const isOwner = Boolean(req.session?.login && owners.includes(req.session.login.toLowerCase()))
      if (!req.isOperator && !isOwner && req.session?.userId && isDatabaseEnabled()) {
        const ent = await getEntitlement(req.session.userId)
        if (!ent.key) return res.status(402).json({ error: ent.reason ?? "Add an API key or upgrade to run tasks.", code: "needs_key_or_plan" })
        keyChoice = ent.key.kind === "byok" ? { keyKind: "byok", keyProvider: ent.key.provider } : { keyKind: "platform" }
      }
      // Count-then-create must not interleave for one user (two quick submits would both pass the
      // active-task check), so admission is serialized per user with a short owner-checked lock.
      const admitKey = req.session?.userId ? `admit:${req.session.userId}` : null
      const admitOwner = randomUUID()
      if (admitKey && !(await taskStore.acquireLock(admitKey, admitOwner, 15_000))) {
        return res.status(429).json({ error: "Another task is being created — try again in a moment." })
      }
      try {
        if (!req.isOperator && req.session?.userId) {
          const active = await countActiveTasksForUser(req.session.userId)
          if (active >= Number(process.env.MAX_ACTIVE_TASKS_PER_USER ?? 1)) {
            return res.status(429).json({ error: "You already have a task running. Wait for it to finish or cancel it." })
          }
        }
        const s = await createTask(
          {
            issueUrl: parsed.data.issueUrl,
            ...(req.session?.userId ? { userId: req.session.userId } : {}),
            ...(req.session?.login ? { githubLogin: req.session.login } : {}),
            ...(req.session?.accessToken ? { githubToken: req.session.accessToken } : {}),
            options: {
              ...(parsed.data.autoApprove !== undefined ? { autoApprove: parsed.data.autoApprove } : {}),
              ...(parsed.data.autoPublish !== undefined ? { autoPublish: parsed.data.autoPublish } : {}),
              ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
              ...keyChoice,
            },
          },
          taskRegistry,
        )
        logger.info(`Task created ${s.taskId} for ${s.owner}/${s.repo}#${s.issueNumber}${req.session?.login ? ` by ${req.session.login}` : ""}`)
        res.status(201).json({ taskId: s.taskId, status: s.status, issueUrl: s.issueUrl, issueNumber: s.issueNumber, createdAt: s.createdAt })
      } finally {
        if (admitKey) await taskStore.releaseLock(admitKey, admitOwner)
      }
    } catch (err) {
      logger.error(`create task failed: ${(err as Error).message}`)
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.get("/task/:taskId", async (req, res) => {
    const taskId = String(req.params.taskId)
    const s = await taskStore.get(taskId)
    if (s) {
      if (!(await canAccess(req, taskId, s.userId))) return res.status(403).json({ error: "Forbidden" })
      return res.json(publicView(s))
    }
    if (!(await canAccess(req, taskId))) return res.status(404).json({ error: "Task not found" })
    const fromDb = await getTaskDetailFromDb(taskId)
    if (fromDb) return res.json(fromDb)
    res.status(404).json({ error: "Task not found" })
  })

  router.get("/task/:taskId/events", async (req, res) => {
    const taskId = String(req.params.taskId)
    const s = await taskStore.get(taskId)
    if (!(await canAccess(req, taskId, s?.userId))) return res.status(403).json({ error: "Forbidden" })
    const after = Number(req.query.after ?? -1)
    const events = await eventLog.range(taskId, Number.isFinite(after) && after >= 0 ? after + 1 : 0)
    res.json(events)
  })

  // Every model call of a task (from llm_calls): cost, tokens, model and provider per call.
  router.get("/task/:taskId/calls", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    await flushLlmCalls().catch(() => 0) // include this process's not-yet-written rows
    res.json(await listCallsForTask(s.taskId))
  })

  router.get("/task/:taskId/stream", async (req, res) => {
    const taskId = String(req.params.taskId)
    const s = await taskStore.get(taskId)
    if (!(await canAccess(req, taskId, s?.userId))) return res.status(403).json({ error: "Forbidden" })

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders()

    const lastId = Number(req.header("Last-Event-ID") ?? req.query.after ?? -1)
    let sent = Number.isFinite(lastId) ? lastId : -1
    const emitter = eventBus.subscribe(taskId)
    const buffered: { seq: number; event: unknown }[] = []
    let replaying = true
    const write = (seq: number, event: unknown) => {
      if (seq <= sent) return
      sent = seq
      res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`)
    }
    const onEvent = (event: unknown, seq: number) => (replaying ? buffered.push({ seq, event }) : write(seq, event))
    emitter.on("event", onEvent)

    const from = sent + 1
    const stored = await eventLog.range(taskId, from)
    stored.forEach((e, i) => write(from + i, e))
    replaying = false
    for (const b of buffered) write(b.seq, b.event)

    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15_000)
    req.on("close", () => {
      clearInterval(heartbeat)
      emitter.off("event", onEvent)
      eventBus.cleanup(taskId)
    })
  })

  router.get("/task/:taskId/metrics", async (req, res) => {
    const taskId = String(req.params.taskId)
    const s = await taskStore.get(taskId)
    if (!(await canAccess(req, taskId, s?.userId))) return res.status(403).json({ error: "Forbidden" })
    if (s) return res.json(metricsOf(s))
    const m = (await taskRegistry.getMetrics(taskId)) ?? (await getMetricsFromDb(taskId))
    if (!m) return res.status(404).json({ error: "Metrics not found" })
    res.json(m)
  })

  router.post("/task/:taskId/approve", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    if (s.status !== "awaiting_approval") return res.status(409).json({ error: `Task is ${s.status}, not awaiting approval` })
    const parsed = Approve.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid plan" })
    // Atomic: a double-clicked Approve must not start two runs.
    const next = await taskStore.transition(s.taskId, ["awaiting_approval"], (cur) => {
      if (parsed.data.steps && cur.plan) {
        cur.plan.steps = parsed.data.steps
        cur.planChecklist = parsed.data.steps.map((st) => ({ title: st.title, status: "pending" }))
        const files = new Map(cur.plan.files.map((f) => [f.path, f]))
        for (const st of parsed.data.steps) for (const f of st.files) if (!files.has(f)) files.set(f, { path: f, new: false })
        cur.plan.files = [...files.values()]
      }
      if (parsed.data.requirements && cur.plan) cur.plan.requirements = parsed.data.requirements
      if ((parsed.data.steps || parsed.data.requirements) && cur.plan) cur.plan.editedByUser = true
      if (parsed.data.note && cur.plan) cur.plan.userNotes = [...(cur.plan.userNotes ?? []), parsed.data.note]
      return { ...cur, status: "running", statusDetail: "Plan approved" }
    })
    if (!next) return res.status(409).json({ error: "This plan was already approved" })
    if (parsed.data.note) await taskStore.pushMessage(s.taskId, parsed.data.note)
    await eventBus.emit(s.taskId, { type: "status", status: "running", detail: "Plan approved" })
    await enqueue("run", s.taskId)
    res.json({ ok: true })
  })

  // Changed decisions at plan approval: back to the planner with the user's choices (steps and
  // requirements are rebuilt around them rather than patched).
  router.post("/task/:taskId/replan", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const parsed = Replan.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Say what to change" })
    const text = parsed.data.text
    const next = await taskStore.transition(s.taskId, ["awaiting_approval"], (cur) => {
      const n: TaskState = { ...cur, status: "planning", statusDetail: "Re-planning with your choices", planMessage: `${cur.planMessage ?? ""}\n\n## Clarification from the user\n${text}` }
      delete n.plan
      return n
    })
    if (!next) return res.status(409).json({ error: "The plan is no longer waiting for approval" })
    await eventBus.emit(s.taskId, { type: "user_message", text })
    await eventBus.emit(s.taskId, { type: "status", status: "planning", detail: "Re-planning with your choices" })
    await enqueue("plan", s.taskId)
    res.json({ ok: true })
  })

  // Issue images Pullwright downloaded (for the plan view); only the task's owner can read them.
  router.get("/task/:taskId/attachments/:n", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const a = s.intake?.attachments.find((x) => x.n === Number(req.params.n))
    if (!a?.file || !a.mime || !existsSync(a.file)) return res.status(404).json({ error: "Attachment not available" })
    res.setHeader("Content-Type", a.mime)
    res.setHeader("Cache-Control", "private, max-age=3600")
    res.setHeader("X-Content-Type-Options", "nosniff")
    // The task dir lives under .tasks/; the path comes from our own state, never from the request.
    res.sendFile(a.file, { dotfiles: "allow" })
  })

  router.post("/task/:taskId/message", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const parsed = Message.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Message is required" })
    const text = parsed.data.text
    if (TERMINAL.includes(s.status)) return res.status(409).json({ error: `Task is ${s.status}` })
    if (s.status === "needs_input") {
      await eventBus.emit(s.taskId, { type: "user_message", text })
      if (!s.plan || s.plan.blocked) {
        // Clarification during planning: re-plan with the answer.
        const next = await taskStore.transition(s.taskId, ["needs_input"], (cur) => {
          const n: TaskState = { ...cur, status: "planning", planMessage: `${cur.planMessage ?? ""}\n\n## Clarification from the user\n${text}` }
          delete n.pendingQuestion
          return n
        })
        if (!next) return res.status(409).json({ error: "The task is no longer waiting for an answer" })
        await enqueue("plan", s.taskId)
      } else {
        const next = await taskStore.transition(s.taskId, ["needs_input"], (cur) => ({ ...cur, status: "running" }))
        if (!next) return res.status(409).json({ error: "The task is no longer waiting for an answer" })
        await taskStore.pushMessage(s.taskId, text)
        await enqueue("run", s.taskId)
      }
      return res.json({ ok: true, resumed: true })
    }
    if (s.status === "ready" || s.status === "needs_review") {
      // Follow-up change request on a finished run (Jules-style feedback).
      const next = await taskStore.transition(s.taskId, ["ready", "needs_review"], (cur) => ({ ...cur, status: "running", statusDetail: "Applying your feedback" }))
      if (!next) return res.status(409).json({ error: "The task is already working on something" })
      await eventBus.emit(s.taskId, { type: "user_message", text })
      await taskStore.pushMessage(s.taskId, text)
      await enqueue("run", s.taskId)
      return res.json({ ok: true, resumed: true })
    }
    await eventBus.emit(s.taskId, { type: "user_message", text })
    await taskStore.pushMessage(s.taskId, text)
    res.json({ ok: true, queued: true })
  })

  router.post("/task/:taskId/cancel", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    if (TERMINAL.includes(s.status)) return res.status(409).json({ error: `Task is already ${s.status}` })
    await taskStore.cancel(s.taskId)
    // Idle tasks are cancelled right here; a running stage sees the flag and stops itself.
    const idle = await taskStore.transition(s.taskId, ["awaiting_approval", "needs_input", "ready", "needs_review", "queued"], (cur) => ({
      ...cur,
      status: "cancelled",
      statusDetail: "Cancelled by user",
      finishedAt: new Date().toISOString(),
    }))
    if (idle) {
      await eventBus.emit(s.taskId, { type: "status", status: "cancelled", detail: "Cancelled by user" })
      await taskStore.dropToken(s.taskId)
    }
    res.json({ ok: true })
  })

  router.get("/task/:taskId/diff", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    let patch = (await taskStore.loadPatch(s.taskId)) ?? ""
    let stats = s.stats ?? []
    // While the agent is still working, show the live working-tree diff (host-side, read-only).
    const live = ["running", "validating", "needs_input"].includes(s.status)
    if ((live || !patch) && s.workDir && s.baseSha && existsSync(s.workDir)) {
      try {
        patch = await diffVs(s.workDir, s.baseSha)
        stats = await diffStat(s.workDir, s.baseSha)
      } catch {
        /* workspace busy or gone */
      }
    }
    res.json({ patch, stats, live, rejectedFiles: s.rejectedFiles, acceptedPatch: filterPatch(patch, new Set(s.rejectedFiles)) })
  })

  router.post("/task/:taskId/files", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const parsed = Reject.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid request" })
    if (!["ready", "needs_review"].includes(s.status)) return res.status(409).json({ error: "Files can only be reviewed before publishing" })
    const next = await taskStore.transition(s.taskId, ["ready", "needs_review"], (cur) => {
      const set = new Set(cur.rejectedFiles)
      if (parsed.data.rejected) set.add(parsed.data.path)
      else set.delete(parsed.data.path)
      return { ...cur, rejectedFiles: [...set] }
    })
    if (!next) return res.status(409).json({ error: "Files can only be reviewed before publishing" })
    res.json({ rejectedFiles: next.rejectedFiles })
  })

  router.post("/task/:taskId/restore", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const parsed = Restore.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid checkpoint" })
    if (!["ready", "needs_review"].includes(s.status) || !s.workDir) return res.status(409).json({ error: "Checkpoints can be restored only when the agent is not running" })
    if (!s.checkpoints.some((c) => c.sha.startsWith(parsed.data.sha))) return res.status(404).json({ error: "Unknown checkpoint" })
    await restoreCheckpoint(s.workDir, parsed.data.sha)
    await eventBus.emit(s.taskId, { type: "notice", level: "info", message: `Restored checkpoint ${parsed.data.sha.slice(0, 7)}` })
    res.json({ ok: true })
  })

  router.post("/task/:taskId/publish", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    if (!["ready", "needs_review"].includes(s.status)) return res.status(409).json({ error: `Task is ${s.status}; nothing to publish yet` })
    const next = await taskStore.transition(s.taskId, ["ready", "needs_review"], (cur) => ({ ...cur, status: "publishing", statusDetail: "Queued for publishing" }))
    if (!next) return res.status(409).json({ error: "Already publishing" })
    await enqueue("publish", s.taskId)
    res.json({ ok: true })
  })

  // Budget extension: a run stopped by its spend cap can continue with more budget (user's decision).
  const Extend = z.object({ addUsd: z.number().min(0.05).max(0.5) })
  router.post("/task/:taskId/extend", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const parsed = Extend.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Add between $0.05 and $0.50" })
    if (!["needs_review", "failed"].includes(s.status) || !s.runMessages?.length) {
      return res.status(409).json({ error: "Only a run that stopped early can be continued" })
    }
    const next = await taskStore.transition(s.taskId, ["needs_review", "failed"], (cur) => {
      const n: TaskState = { ...cur, status: "running", statusDetail: "Continuing with more budget", options: { ...cur.options, capUsd: +(taskCap(cur) + parsed.data.addUsd).toFixed(2) } }
      delete n.failureReason
      delete n.finishedAt
      return n
    })
    if (!next) return res.status(409).json({ error: "Only a run that stopped early can be continued" })
    await taskStore.pushMessage(s.taskId, "The budget was increased. Continue where you left off: finish the remaining requirements, verify, then call finish.")
    await eventBus.emit(s.taskId, { type: "status", status: "running", detail: `Budget raised to $${next.options.capUsd}` })
    await enqueue("run", s.taskId)
    res.json({ ok: true, capUsd: next.options.capUsd })
  })

  const Share = z.object({ public: z.boolean() })
  router.post("/task/:taskId/share", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    const parsed = Share.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid request" })
    if (s.source) return res.status(409).json({ error: "Eval tasks can't be shared" })
    if (!isDatabaseEnabled()) return res.status(409).json({ error: "Sharing needs the database" })
    if (!["published", "ready", "needs_review", "failed", "cancelled"].includes(s.status)) return res.status(409).json({ error: "Share a task once it has finished" })
    await getPrisma().task.updateMany({ where: { id: s.taskId }, data: { isPublic: parsed.data.public } })
    res.json({ isPublic: parsed.data.public })
  })

  router.post("/task/:taskId/retry", async (req, res) => {
    const s = await load(req, res)
    if (!s) return
    if (!["failed", "cancelled", "needs_review"].includes(s.status)) return res.status(409).json({ error: `Task is ${s.status}` })
    if (!req.isOperator && !req.session?.accessToken) return res.status(401).json({ error: "Sign in again" })
    if (req.session?.accessToken) await taskStore.putToken(s.taskId, req.session.accessToken)
    await taskStore.clearCancel(s.taskId)
    const reset = await taskStore.transition(s.taskId, ["failed", "cancelled", "needs_review"], (cur) => {
      const n: TaskState = { ...cur, status: "queued", statusDetail: "Retrying", rejectedFiles: [], checkpoints: [] }
      for (const k of ["plan", "planChecklist", "runMessages", "pendingQuestion", "summary", "gate", "verdict", "stats", "failureReason", "finishedAt", "workDir", "baseline", "planMessage"] as const) delete n[k]
      return n
    })
    if (!reset) return res.status(409).json({ error: "The task is already being retried" })
    await eventLog.clear(s.taskId)
    await enqueue("plan", s.taskId)
    res.json({ ok: true })
  })

  router.get("/tasks", async (req, res) => {
    if (isOwner(req)) {
      // Owners see their own tasks plus operator/eval runs, newest first.
      const mine = req.session?.userId && isDatabaseEnabled() ? await listTasksForUser(req.session.userId, 50) : []
      const all = await taskRegistry.list(50)
      const seen = new Set(mine.map((t) => t.taskId))
      return res.json([...mine, ...all.filter((t) => !seen.has(t.taskId))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60))
    }
    if (req.session?.userId && isDatabaseEnabled()) return res.json(await listTasksForUser(req.session.userId, 50))
    if (req.isOperator) return res.json(await taskRegistry.list(50))
    res.json([])
  })

  router.get("/stats", async (req, res) => {
    if (req.session?.userId && isDatabaseEnabled()) return res.json(await getStatsForUser(req.session.userId))
    res.json({ total: 0, running: 0, done: 0, failed: 0, queued: 0, needsYou: 0, totalCostUsd: 0 })
  })

  router.get("/budget", async (req, res) => {
    const l = getSpendLedger()
    res.json({ taskCapUsd: l.taskCapUsd, ...(req.isOperator ? { platformSpentUsd: await l.platformSpent(), hardStopUsd: l.hardStopUsd } : {}) })
  })

  return router
}
