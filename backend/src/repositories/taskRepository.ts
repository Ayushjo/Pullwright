import { Prisma } from "@prisma/client"
import type { TaskStatus } from "@prisma/client"
import type { TaskMetricsSnapshot } from "../events/types.js"
import type { Step } from "../events/types.js"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import { parseRepoFromIssueUrl } from "../utils/parseRepo.js"
import type { TaskRegistryEntry } from "../store/taskRegistry.js"

function toRegistryEntry(row: {
  id: string
  issueUrl: string
  issueTitle: string
  issueNumber: number
  status: TaskStatus
  createdAt: Date
  updatedAt: Date
  prUrl: string | null
}): TaskRegistryEntry {
  return {
    taskId: row.id,
    issueUrl: row.issueUrl,
    issueTitle: row.issueTitle,
    issueNumber: row.issueNumber,
    status: row.status === "verifying" ? "validating" : row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.prUrl ? { prUrl: row.prUrl } : {}),
  }
}

function mapStatusToPrisma(status: TaskRegistryEntry["status"] | "planning" | "verifying"): TaskStatus {
  return status
}

export type CreateTaskInput = {
  taskId: string
  userId: string
  issueUrl: string
  issueTitle: string
  issueNumber: number
  githubLogin?: string
  branchName?: string
}

export async function createTaskInDb(input: CreateTaskInput): Promise<void> {
  if (!isDatabaseEnabled()) return

  const { owner, repo } = parseRepoFromIssueUrl(input.issueUrl)
  await getPrisma().task.create({
    data: {
      id: input.taskId,
      userId: input.userId,
      issueUrl: input.issueUrl,
      issueTitle: input.issueTitle,
      issueNumber: input.issueNumber,
      repoOwner: owner,
      repoName: repo,
      branchName: input.branchName ?? `pullwright/task-${input.taskId}`,
      githubLogin: input.githubLogin ?? null,
      status: "queued",
    },
  })
}

export async function updateTaskInDb(
  taskId: string,
  patch: {
    status?: TaskRegistryEntry["status"] | "planning" | "verifying"
    issueTitle?: string
    issueNumber?: number
    prUrl?: string
    failureReason?: string
    branchName?: string
    completedAt?: Date | null
  },
): Promise<void> {
  if (!isDatabaseEnabled()) return

  const data: Record<string, unknown> = {}
  if (patch.status) data.status = mapStatusToPrisma(patch.status)
  if (patch.issueTitle) data.issueTitle = patch.issueTitle
  if (patch.issueNumber !== undefined) data.issueNumber = patch.issueNumber
  if (patch.prUrl !== undefined) data.prUrl = patch.prUrl
  if (patch.failureReason !== undefined) data.failureReason = patch.failureReason
  if (patch.branchName !== undefined) data.branchName = patch.branchName
  if (patch.completedAt !== undefined) data.completedAt = patch.completedAt

  if (Object.keys(data).length === 0) return

  await getPrisma().task.update({
    where: { id: taskId },
    data,
  })
}

export async function getTaskFromDb(taskId: string) {
  if (!isDatabaseEnabled()) return null
  return getPrisma().task.findUnique({ where: { id: taskId } })
}

export async function getTaskEntryFromDb(taskId: string): Promise<TaskRegistryEntry | null> {
  const row = await getTaskFromDb(taskId)
  return row ? toRegistryEntry(row) : null
}

export async function listTasksForUser(userId: string, limit = 50): Promise<TaskRegistryEntry[]> {
  if (!isDatabaseEnabled()) return []

  const rows = await getPrisma().task.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return rows.map(toRegistryEntry)
}

export async function getStatsForUser(userId: string) {
  if (!isDatabaseEnabled()) {
    return { total: 0, running: 0, done: 0, failed: 0, queued: 0 }
  }

  const db = getPrisma()
  const [total, running, done, failed, queued, needsYou, cost] = await Promise.all([
    db.task.count({ where: { userId } }),
    db.task.count({ where: { userId, status: { in: ["running", "planning", "verifying", "preparing", "validating", "publishing"] } } }),
    db.task.count({ where: { userId, status: { in: ["done", "published"] } } }),
    db.task.count({ where: { userId, status: { in: ["failed", "cancelled"] } } }),
    db.task.count({ where: { userId, status: "queued" } }),
    db.task.count({ where: { userId, status: { in: ["awaiting_approval", "needs_input", "ready", "needs_review"] } } }),
    db.task.aggregate({ where: { userId }, _sum: { costUsd: true } }),
  ])
  return { total, running, done, failed, queued, needsYou, totalCostUsd: cost._sum.costUsd ?? 0 }
}

/** Mirror the v2 task state into Postgres (source of truth for history/replays). */
export async function syncTaskStateToDb(s: {
  taskId: string
  status: TaskStatus
  title: string
  issueNumber: number
  prUrl?: string
  prBranch?: string
  failureReason?: string
  finishedAt?: string
  plan?: unknown
  summary?: string
  verdict?: unknown
  stats?: unknown
  options?: unknown
  costUsd: number
}): Promise<void> {
  if (!isDatabaseEnabled()) return
  const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
  await getPrisma().task.updateMany({
    where: { id: s.taskId },
    data: {
      status: s.status,
      ...(s.title ? { issueTitle: s.title } : {}),
      ...(s.prUrl ? { prUrl: s.prUrl } : {}),
      ...(s.prBranch ? { branchName: s.prBranch } : {}),
      ...(s.failureReason ? { failureReason: s.failureReason } : {}),
      ...(s.finishedAt ? { completedAt: new Date(s.finishedAt) } : {}),
      ...(s.plan !== undefined ? { plan: json(s.plan) } : {}),
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.verdict !== undefined ? { verdict: json(s.verdict) } : {}),
      ...(s.stats !== undefined ? { diffStats: json(s.stats) } : {}),
      ...(s.options !== undefined ? { options: json(s.options) } : {}),
      costUsd: s.costUsd,
    },
  })
}

export async function userOwnsTask(userId: string, taskId: string): Promise<boolean> {
  if (!isDatabaseEnabled()) return true
  const row = await getPrisma().task.findFirst({
    where: { id: taskId, userId },
    select: { id: true },
  })
  return Boolean(row)
}

export async function saveMetricsToDb(taskId: string, metrics: TaskMetricsSnapshot): Promise<void> {
  if (!isDatabaseEnabled()) return

  await getPrisma().taskMetrics.upsert({
    where: { taskId },
    create: {
      taskId,
      durationMs: metrics.durationMs,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      costUsd: metrics.costUsd,
      shadowCostUsd: metrics.shadowCostUsd,
      llmCalls: metrics.llmCalls,
      toolCalls: metrics.toolCalls,
      retries: metrics.retries,
      routerRetries: metrics.routerRetries ?? null,
      providerFailovers: metrics.providerFailovers ?? null,
      phases: metrics.phases as object,
      budgetUsedUsd: metrics.budgetUsedUsd ?? null,
      budgetLimitUsd: metrics.budgetLimitUsd ?? null,
    },
    update: {
      durationMs: metrics.durationMs,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      costUsd: metrics.costUsd,
      shadowCostUsd: metrics.shadowCostUsd,
      llmCalls: metrics.llmCalls,
      toolCalls: metrics.toolCalls,
      retries: metrics.retries,
      routerRetries: metrics.routerRetries ?? null,
      providerFailovers: metrics.providerFailovers ?? null,
      phases: metrics.phases as object,
      budgetUsedUsd: metrics.budgetUsedUsd ?? null,
      budgetLimitUsd: metrics.budgetLimitUsd ?? null,
      recordedAt: new Date(),
    },
  })
}

export async function getMetricsFromDb(taskId: string): Promise<TaskMetricsSnapshot | null> {
  if (!isDatabaseEnabled()) return null

  const row = await getPrisma().taskMetrics.findUnique({ where: { taskId } })
  if (!row) return null

  const snapshot: TaskMetricsSnapshot = {
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: Number(row.costUsd),
    shadowCostUsd: Number(row.shadowCostUsd),
    llmCalls: row.llmCalls,
    toolCalls: row.toolCalls,
    retries: row.retries,
    phases: row.phases as TaskMetricsSnapshot["phases"],
  }
  if (row.routerRetries != null) snapshot.routerRetries = row.routerRetries
  if (row.providerFailovers != null) snapshot.providerFailovers = row.providerFailovers
  if (row.budgetUsedUsd != null) snapshot.budgetUsedUsd = Number(row.budgetUsedUsd)
  if (row.budgetLimitUsd != null) snapshot.budgetLimitUsd = Number(row.budgetLimitUsd)
  return snapshot
}

export async function upsertStepInDb(taskId: string, step: Step, status = "running"): Promise<void> {
  if (!isDatabaseEnabled()) return

  const now = new Date()
  await getPrisma().taskStep.upsert({
    where: { taskId_stepNumber: { taskId, stepNumber: step.id } },
    create: {
      taskId,
      stepNumber: step.id,
      title: step.title ?? null,
      description: step.description,
      status,
      startedAt: now,
    },
    update: {
      title: step.title ?? null,
      description: step.description,
      status,
    },
  })
}

export async function completeStepInDb(taskId: string, stepNumber: number, outputSummary?: string): Promise<void> {
  if (!isDatabaseEnabled()) return

  await getPrisma().taskStep.updateMany({
    where: { taskId, stepNumber },
    data: {
      status: "done",
      completedAt: new Date(),
      ...(outputSummary ? { outputSummary } : {}),
    },
  })
}

export async function syncStepsToDb(taskId: string, steps: Step[]): Promise<void> {
  if (!isDatabaseEnabled() || steps.length === 0) return

  for (const step of steps) {
    await getPrisma().taskStep.upsert({
      where: { taskId_stepNumber: { taskId, stepNumber: step.id } },
      create: {
        taskId,
        stepNumber: step.id,
        title: step.title ?? null,
        description: step.description,
        status: "pending",
      },
      update: {
        title: step.title ?? null,
        description: step.description,
      },
    })
  }
}

export async function getTaskDetailFromDb(taskId: string): Promise<{
  issueUrl: string
  issueTitle: string
  issueNumber: number
  status: TaskRegistryEntry["status"]
  prUrl?: string
  failureReason?: string
  branchName: string
  repoName: string
  createdAt: string
  steps: Step[]
  completedStepIds: number[]
} | null> {
  if (!isDatabaseEnabled()) return null

  const row = await getPrisma().task.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  })
  if (!row) return null

  const completedStepIds: number[] = []
  const steps: Step[] = row.steps.map((s) => {
    if (s.status === "done") completedStepIds.push(s.stepNumber)
    const step: Step = {
      id: s.stepNumber,
      title: s.title ?? `Step ${s.stepNumber}`,
      description: s.description,
    }
    return step
  })

  const repoName =
    row.repoOwner && row.repoName ? `${row.repoOwner}/${row.repoName}` : row.issueUrl.replace("https://github.com/", "").split("/").slice(0, 2).join("/")

  const entry = toRegistryEntry(row)
  return {
    issueUrl: row.issueUrl,
    issueTitle: row.issueTitle,
    issueNumber: row.issueNumber,
    status: entry.status,
    ...(row.prUrl ? { prUrl: row.prUrl } : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    branchName: row.branchName ?? `pullwright/task-${taskId}`,
    repoName,
    createdAt: row.createdAt.toISOString(),
    steps,
    completedStepIds,
  }
}

export async function isTaskTerminalInDb(taskId: string): Promise<boolean> {
  if (!isDatabaseEnabled()) return false
  const row = await getPrisma().task.findUnique({
    where: { id: taskId },
    select: { status: true },
  })
  return row?.status === "done" || row?.status === "failed"
}
