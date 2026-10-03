import { DelayedError, Queue, Worker, type Job } from "bullmq"
import type { Redis } from "ioredis"
import { v4 as uuidv4 } from "uuid"
import { createRedisClient, getRedisOptions } from "../config/redis.js"
import type { EventBus } from "../events/eventBus.js"
import type { TaskRegistry } from "../store/taskRegistry.js"
import { createTaskInDb, saveMetricsToDb, syncTaskStateToDb } from "../repositories/taskRepository.js"
import { recordTaskUsage } from "../repositories/usageRepository.js"
import logger from "../logger.js"
import { Pipeline, metricsOf, type StageName } from "./pipeline.js"
import { parseIssueUrl } from "./git.js"
import { taskStore, TERMINAL, type TaskOptions, type TaskState, type TaskStatus } from "./store.js"
import { getSpendLedger } from "./spend.js"
import { Sandbox, WORKER_ID } from "./sandbox.js"

/**
 * Task service: creates tasks, runs the three pipeline stages on a BullMQ queue,
 * and mirrors state into the legacy registry (Redis) + Postgres.
 * Jobs only ever carry {stage, taskId} — no secrets.
 */

const QUEUE = "pullwright"
const connection = getRedisOptions() as Record<string, unknown>
export const pwQueue = new Queue(QUEUE, { connection })

let genRedis: Redis | null = null

/**
 * Jobs carry a per-task generation number (monotonic, also a fencing token for later park/resume),
 * and enqueueing the same stage of the same task twice within 3 s is deduplicated.
 */
/** Next generation number for a task (also the fencing token a parked task stores for its resume). */
export async function allocGen(taskId: string): Promise<number> {
  genRedis ??= createRedisClient()
  const gen = await genRedis.incr(`pw:gen:${taskId}`)
  await genRedis.expire(`pw:gen:${taskId}`, 30 * 24 * 3600)
  return gen
}

/** opts.gen: a generation already stored on the task (resume) — allocate it first, save it, then enqueue. */
export async function enqueue(stage: StageName, taskId: string, opts: { delayMs?: number; resume?: boolean; gen?: number } = {}): Promise<number> {
  const gen = opts.gen ?? (await allocGen(taskId))
  await pwQueue.add(stage, { stage, taskId, gen, ...(opts.resume ? { resume: true } : {}) }, {
    jobId: `${taskId}:${stage}:${gen}`,
    // Resumes are fenced by gen instead (a manual "resume now" must not be swallowed by a pending delayed job).
    ...(opts.resume ? {} : { deduplication: { id: `${taskId}:${stage}`, ttl: 3000 } }),
    ...(opts.delayMs && opts.delayMs > 0 ? { delay: Math.round(opts.delayMs) } : {}),
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 24 * 3600, count: 500 },
    attempts: 1,
  })
  return gen
}

/** A parked task whose wait has run out without resuming is finalized (partial work kept for review). */
export const MAX_PARK_MS = Number(process.env.PW_MAX_PARK_HOURS ?? 48) * 3_600_000

/** Statuses in which a stage may (still) run. A duplicate job that finds the task elsewhere is skipped. */
const STAGE_FROM: Record<StageName, TaskStatus[]> = {
  plan: ["queued", "preparing", "planning"],
  run: ["running", "validating"],
  publish: ["publishing"],
}
const LOCK_MS = 90_000

export function makeStatusSink(registry: TaskRegistry) {
  return async (s: TaskState) => {
    s.costUsd = getSpendLedger().taskSpent(s.taskId)
    await registry.registerOrUpdate(s.taskId, {
      issueUrl: s.issueUrl,
      issueTitle: s.title || `Issue #${s.issueNumber}`,
      issueNumber: s.issueNumber,
      status: s.status,
      ...(s.prUrl ? { prUrl: s.prUrl } : {}),
    })
    const metrics = metricsOf(s)
    await registry.saveMetrics(s.taskId, metrics)
    await syncTaskStateToDb({
      taskId: s.taskId,
      status: s.status,
      title: s.title,
      issueNumber: s.issueNumber,
      ...(s.prUrl ? { prUrl: s.prUrl } : {}),
      ...(s.prBranch ? { prBranch: s.prBranch } : {}),
      ...(s.failureReason ? { failureReason: s.failureReason } : {}),
      ...(s.finishedAt ? { finishedAt: s.finishedAt } : {}),
      ...(s.plan ? { plan: s.plan } : {}),
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.verdict ? { verdict: s.verdict } : {}),
      ...(s.stats ? { stats: s.stats } : {}),
      options: s.options,
      costUsd: s.costUsd,
    }).catch((e) => logger.warn(`db sync failed: ${e}`))
    if (TERMINAL.includes(s.status)) {
      await saveMetricsToDb(s.taskId, metrics).catch(() => {})
      if (s.userId && metrics.costUsd > 0) {
        await recordTaskUsage({ userId: s.userId, taskId: s.taskId, totalUsd: metrics.costUsd, metadata: { llmCalls: metrics.llmCalls, status: s.status } }).catch(() => {})
      }
    }
  }
}

export type CreateTaskInput = {
  issueUrl: string
  local?: { repoPath: string; title: string; body: string }
  userId?: string
  githubLogin?: string
  githubToken?: string
  options?: Partial<TaskOptions>
}

export async function createTask(input: CreateTaskInput, registry: TaskRegistry): Promise<TaskState> {
  const ref = input.local
    ? { owner: "local", repo: input.local.repoPath.split("/").filter(Boolean).pop() ?? "repo", issueNumber: 0 }
    : parseIssueUrl(input.issueUrl)
  const taskId = uuidv4()
  const now = new Date().toISOString()
  const state: TaskState = {
    taskId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.githubLogin ? { githubLogin: input.githubLogin } : {}),
    issueUrl: input.local ? `local://${ref.repo}` : `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`,
    ...(input.local ? { source: { kind: "local" as const, repoPath: input.local.repoPath } } : {}),
    owner: ref.owner,
    repo: ref.repo,
    issueNumber: ref.issueNumber,
    title: input.local?.title ?? `Issue #${ref.issueNumber}`,
    body: input.local?.body ?? "",
    comments: [],
    status: "queued",
    options: {
      autoApprove: input.options?.autoApprove ?? false,
      autoPublish: input.options?.autoPublish ?? false,
      draft: input.options?.draft ?? true,
      ...(input.options?.model ? { model: input.options.model } : {}),
      keyKind: input.options?.keyKind ?? "platform",
      ...(input.options?.keyProvider ? { keyProvider: input.options.keyProvider } : {}),
    },
    rejectedFiles: [],
    checkpoints: [],
    costUsd: 0,
    llmCalls: 0,
    toolCalls: 0,
    createdAt: now,
    updatedAt: now,
  }
  await taskStore.put(state)
  if (input.githubToken) await taskStore.putToken(taskId, input.githubToken)
  await registry.register({ taskId, issueUrl: state.issueUrl, issueTitle: state.title, issueNumber: ref.issueNumber, status: "queued", createdAt: now, updatedAt: now })
  if (input.userId) {
    await createTaskInDb({
      taskId,
      userId: input.userId,
      issueUrl: state.issueUrl,
      issueTitle: state.title,
      issueNumber: ref.issueNumber,
      ...(input.githubLogin ? { githubLogin: input.githubLogin } : {}),
    })
  }
  await enqueue("plan", taskId)
  return state
}

export function startPipelineWorker(bus: EventBus, registry: TaskRegistry) {
  const pipeline = new Pipeline(bus, enqueue, makeStatusSink(registry))
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1)
  const worker = new Worker(
    QUEUE,
    async (job: Job<{ stage: StageName; taskId: string; gen?: number; resume?: boolean }>, token?: string) => {
      const { stage, taskId } = job.data
      // One stage per task at a time, across all workers.
      const owner = `${WORKER_ID}:${job.id}`
      if (!(await taskStore.acquireLock(taskId, owner, LOCK_MS))) {
        logger.info(`⏸ ${stage} ${taskId}: another stage holds the task, retrying in 3 s`)
        await job.moveToDelayed(Date.now() + 3_000, token)
        throw new DelayedError()
      }
      const renew = setInterval(() => {
        void taskStore.renewLock(taskId, owner, LOCK_MS).then((ok) => ok || logger.warn(`Lost the stage lock for ${taskId}`))
      }, LOCK_MS / 3)
      try {
        let s = await taskStore.get(taskId)
        // Resuming a parked task: only the job generation scheduled by the latest park (or a manual resume)
        // may wake it, and only once (CAS). Stale delayed jobs find a different gen and do nothing.
        if (s?.status === "parked") {
          if (!job.data.resume || !s.park || job.data.gen !== s.park.gen) {
            logger.info(`↷ skip ${stage} ${taskId}: parked, not this job's turn`)
            return
          }
          if (Date.now() - Date.parse(s.park.since) > MAX_PARK_MS) {
            await taskStore.unmarkParked(taskId)
            await pipeline.expirePark(taskId)
            return
          }
          s = await taskStore.transition(taskId, ["parked"], (cur) => ({ ...cur, status: stage === "plan" ? "planning" : "running", statusDetail: "Resuming after a pause" }))
          if (!s) return
          await taskStore.unmarkParked(taskId)
          await bus.emit(taskId, { type: "resumed", stage })
        }
        if (!s || !STAGE_FROM[stage].includes(s.status)) {
          logger.info(`↷ skip ${stage} ${taskId}: task is ${s?.status ?? "gone"}`)
          return
        }
        logger.info(`▶ ${stage} ${taskId}`)
        if (stage === "plan") await pipeline.plan(taskId)
        else if (stage === "run") await pipeline.run(taskId)
        else if (stage === "publish") await pipeline.publish(taskId)
      } finally {
        clearInterval(renew)
        await taskStore.releaseLock(taskId, owner)
      }
    },
    { connection, concurrency, lockDuration: 60_000 },
  )
  worker.on("failed", (job, err) => logger.error(`Job ${job?.id} failed: ${err?.message}`))
  // Sweeper: a parked task whose resume time passed 5 minutes ago and is still parked lost its delayed job
  // (e.g. Redis was flushed); schedule a fresh one. The new gen fences any old job that shows up late.
  // Orphans: an in-flight task with no lock, no queued/active job, and no update for 2 minutes lost its
  // job — e.g. a crash between "status → running" and enqueueing the run stage. Re-queue the stage its
  // status implies; extra jobs are harmless (stage lock + STAGE_FROM make them no-ops).
  const STAGE_OF: Partial<Record<TaskStatus, StageName>> = { queued: "plan", preparing: "plan", planning: "plan", running: "run", validating: "run", publishing: "publish" }
  const sweepOrphans = async () => {
    const ids = await taskStore.inFlight()
    if (!ids.length) return
    const jobs = await pwQueue.getJobs(["active", "waiting", "delayed", "prioritized", "paused"])
    const withJob = new Set(jobs.map((j) => (j?.data as { taskId?: string } | undefined)?.taskId).filter(Boolean))
    for (const id of ids) {
      const t = await taskStore.get(id)
      const stage = t ? STAGE_OF[t.status] : undefined
      if (!t || !stage) {
        await taskStore.dropInFlight(id)
        continue
      }
      if (Date.now() - Date.parse(t.updatedAt) < 2 * 60_000 || withJob.has(id) || (await taskStore.isLocked(id))) continue
      await enqueue(stage, id)
      logger.warn(`sweeper: task ${id} was ${t.status} with no job — re-queued its ${stage} stage`)
    }
  }
  void taskStore.backfillInFlight().then(sweepOrphans).catch((e) => logger.warn(`orphan sweeper: ${(e as Error).message}`))
  const sweep = setInterval(() => {
    void sweepOrphans().catch((e) => logger.warn(`orphan sweeper: ${(e as Error).message}`))
    void (async () => {
      for (const id of await taskStore.parkedDue(Date.now() - 5 * 60_000)) {
        const t = await taskStore.get(id)
        if (!t || t.status !== "parked" || !t.park || t.park.until === null) {
          await taskStore.unmarkParked(id)
          continue
        }
        const gen = await allocGen(id)
        if (!(await taskStore.transition(id, ["parked"], (cur) => ({ ...cur, park: { ...cur.park!, gen } })))) continue
        await enqueue(t.park.stage, id, { resume: true, gen })
        logger.info(`sweeper: re-scheduled resume of parked task ${id}`)
      }
    })().catch((e) => logger.warn(`park sweeper: ${(e as Error).message}`))
  }, 60_000)
  sweep.unref()
  // Containers left over from a crash are reaped on start.
  void Sandbox.reapAll().then((n) => n && logger.info(`Reaped ${n} stale sandbox containers`)).catch(() => {})
  return worker
}
