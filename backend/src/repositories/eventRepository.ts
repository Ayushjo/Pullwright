import type { TaskEvent } from "../events/types.js"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import logger from "../logger.js"

export async function appendEventToDb(
  taskId: string,
  sequence: number,
  event: TaskEvent,
): Promise<void> {
  if (!isDatabaseEnabled()) return

  try {
    await getPrisma().taskEvent.create({
      data: {
        taskId,
        sequence,
        eventType: event.type,
        payload: event as object,
      },
    })
  } catch (error) {
    if ((error as { code?: string })?.code === "P2003") return // an operator/eval task: no task row, nothing to attach to
    logger.error(`Failed to persist event to Postgres: ${error instanceof Error ? error.message : error}`, {
      taskId,
      sequence,
      type: event.type,
    })
  }
}

/** Events with sequence in [from, toExclusive), in order. */
export async function listEventsFromDb(taskId: string, from = 0, toExclusive?: number): Promise<TaskEvent[]> {
  if (!isDatabaseEnabled()) return []

  const rows = await getPrisma().taskEvent.findMany({
    where: { taskId, sequence: { gte: from, ...(toExclusive !== undefined ? { lt: toExclusive } : {}) } },
    orderBy: { sequence: "asc" },
  })
  return rows.map((row) => row.payload as TaskEvent)
}

/** Highest stored sequence for a task, or -1 if none. Seeds the Redis sequence counter after it expires. */
export async function maxEventSeqInDb(taskId: string): Promise<number> {
  if (!isDatabaseEnabled()) return -1
  const row = await getPrisma().taskEvent.findFirst({ where: { taskId }, orderBy: { sequence: "desc" }, select: { sequence: true } })
  return row?.sequence ?? -1
}

// ── Batched write-behind ──────────────────────────────────────────────────────
// One INSERT per event kept Neon's compute awake around the clock (~180 CU-h/month vs 100 free).
// Events are buffered per process and written with createMany every few seconds; Redis holds the
// live copy meanwhile, and the buffer is flushed on shutdown.

type PendingEvent = { taskId: string; sequence: number; event: TaskEvent }
const pending: PendingEvent[] = []
let timer: NodeJS.Timeout | null = null
const FLUSH_MS = Number(process.env.EVENT_FLUSH_MS ?? 3000)
const MAX_BATCH = 200

export function queueEventForDb(taskId: string, sequence: number, event: TaskEvent): void {
  if (!isDatabaseEnabled()) return
  pending.push({ taskId, sequence, event })
  if (pending.length >= MAX_BATCH) void flushEventsToDb()
  else if (!timer) {
    timer = setTimeout(() => void flushEventsToDb(), FLUSH_MS)
    timer.unref()
  }
}

/** Drop a task's not-yet-written events (a retry clears the log; stale rows must not reappear). */
export function dropPendingEvents(taskId: string): void {
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.taskId === taskId) pending.splice(i, 1)
}

export async function flushEventsToDb(): Promise<number> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  let written = 0
  while (pending.length) {
    const batch = pending.splice(0, MAX_BATCH)
    try {
      const res = await getPrisma().taskEvent.createMany({
        data: batch.map((b) => ({ taskId: b.taskId, sequence: b.sequence, eventType: b.event.type, payload: b.event as object })),
        skipDuplicates: true,
      })
      written += res.count
    } catch (error) {
      // Operator and eval tasks have no task row (by design), so their events can't be stored. A batch mixing
      // them with a user's task used to fail whole and lose the user's events too: keep the ones whose task exists.
      if ((error as { code?: string })?.code === "P2003") {
        const ids = [...new Set(batch.map((b) => b.taskId))]
        const known = new Set((await getPrisma().task.findMany({ where: { id: { in: ids } }, select: { id: true } }).catch(() => [])).map((t) => t.id))
        const keep = batch.filter((b) => known.has(b.taskId))
        if (keep.length) {
          const res = await getPrisma().taskEvent
            .createMany({ data: keep.map((b) => ({ taskId: b.taskId, sequence: b.sequence, eventType: b.event.type, payload: b.event as object })), skipDuplicates: true })
            .catch((e: unknown) => (logger.error(`Failed to persist ${keep.length} events to Postgres: ${e instanceof Error ? e.message : e}`), { count: 0 }))
          written += res.count
        }
        continue
      }
      logger.error(`Failed to persist ${batch.length} events to Postgres: ${error instanceof Error ? error.message : error}`)
    }
  }
  return written
}

export async function clearEventsInDb(taskId: string): Promise<void> {
  if (!isDatabaseEnabled()) return
  await getPrisma().taskEvent.deleteMany({ where: { taskId } })
}

export async function countEventsInDb(taskId: string): Promise<number> {
  if (!isDatabaseEnabled()) return 0
  return getPrisma().taskEvent.count({ where: { taskId } })
}
