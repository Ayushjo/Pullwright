import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import logger from "../logger.js"

export type LlmCallRow = {
  taskId: string
  userId?: string | null
  keyOwner: string
  provider: string
  model: string
  purpose: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
  durationMs?: number
  createdAt?: Date
}

// Batched write-behind, same pattern as events: one createMany every few seconds instead of an
// INSERT per call. Redis counters are the live view; these rows are the durable record.
const pending: LlmCallRow[] = []
let timer: NodeJS.Timeout | null = null
const FLUSH_MS = Number(process.env.LLM_CALL_FLUSH_MS ?? 3000)
const MAX_BATCH = 200

export function queueLlmCall(row: LlmCallRow): void {
  if (!isDatabaseEnabled()) return
  pending.push({ ...row, createdAt: row.createdAt ?? new Date() })
  if (pending.length >= MAX_BATCH) void flushLlmCalls()
  else if (!timer) {
    timer = setTimeout(() => void flushLlmCalls(), FLUSH_MS)
    timer.unref()
  }
}

export async function flushLlmCalls(): Promise<number> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  let written = 0
  while (pending.length) {
    const batch = pending.splice(0, MAX_BATCH)
    try {
      const res = await getPrisma().llmCall.createMany({
        data: batch.map((b) => ({ ...b, userId: b.userId ?? null, durationMs: b.durationMs ?? null })),
      })
      written += res.count
    } catch (error) {
      logger.error(`Failed to persist ${batch.length} llm_calls rows: ${error instanceof Error ? error.message : error}`)
    }
  }
  return written
}

/** Platform-key spend (all time, or since a date) — seeds the Redis counters if they are lost. */
export async function sumPlatformSpend(since?: Date): Promise<number> {
  if (!isDatabaseEnabled()) return 0
  const agg = await getPrisma().llmCall.aggregate({
    _sum: { costUsd: true },
    where: { keyOwner: "platform", ...(since ? { createdAt: { gte: since } } : {}) },
  })
  return Number(agg._sum.costUsd ?? 0)
}

export async function listCallsForTask(taskId: string) {
  if (!isDatabaseEnabled()) return []
  const rows = await getPrisma().llmCall.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } })
  return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }))
}

/** Spend on a budgeted pool key (key_owner "pool") for one provider since a date — seeds the pool counters. */
export async function sumPoolSpend(provider: string, since: Date): Promise<number> {
  if (!isDatabaseEnabled()) return 0
  const agg = await getPrisma().llmCall.aggregate({
    _sum: { costUsd: true },
    where: { keyOwner: "pool", provider, createdAt: { gte: since } },
  })
  return Number(agg._sum.costUsd ?? 0)
}
