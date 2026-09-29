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
export async function enqueue(stage: StageName, taskId: string) {
  genRedis ??= createRedisClient()
  const gen = await genRedis.incr(`pw:gen:${taskId}`)
  await genRedis.expire(`pw:gen:${taskId}`, 30 * 24 * 3600)
  await pwQueue.add(stage, { stage, taskId, gen }, {
    jobId: `${taskId}:${stage}:${gen}`,
    deduplication: { id: `${taskId}:${stage}`, ttl: 3000 },
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 24 * 3600, count: 500 },
    attempts: 1,
  })
}

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
    async (job: Job<{ stage: StageName; taskId: string; gen?: number }>, token?: string) => {
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
        const s = await taskStore.get(taskId)
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
  // Containers left over from a crash are reaped on start.
  void Sandbox.reapAll().then((n) => n && logger.info(`Reaped ${n} stale sandbox containers`)).catch(() => {})
  return worker
}
