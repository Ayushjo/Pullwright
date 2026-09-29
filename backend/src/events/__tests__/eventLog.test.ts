import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import { Redis } from "ioredis"
import type { TaskEvent } from "../../events/types.js"

/**
 * Runs against a real Redis (db 15) so the Lua append script is exercised for real; Postgres is an
 * in-memory stand-in. Skipped when no Redis is reachable.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/15"
const db = new Map<string, { seq: number; event: TaskEvent }[]>()
const queued: { taskId: string; seq: number }[] = []

vi.mock("../../config/redis.js", () => ({ createRedisClient: () => new Redis(REDIS_URL, { maxRetriesPerRequest: 1 }) }))
vi.mock("../../db/prisma.js", () => ({ isDatabaseEnabled: () => true }))
vi.mock("../../repositories/eventRepository.js", () => ({
  queueEventForDb: (taskId: string, seq: number, event: TaskEvent) => {
    queued.push({ taskId, seq })
    db.set(taskId, [...(db.get(taskId) ?? []), { seq, event }])
  },
  dropPendingEvents: vi.fn(),
  listEventsFromDb: async (taskId: string, from = 0, to?: number) =>
    (db.get(taskId) ?? []).filter((r) => r.seq >= from && (to === undefined || r.seq < to)).map((r) => r.event),
  maxEventSeqInDb: async (taskId: string) => Math.max(-1, ...(db.get(taskId) ?? []).map((r) => r.seq)),
  clearEventsInDb: async (taskId: string) => void db.delete(taskId),
}))

let redis: Redis
let available = true
beforeAll(async () => {
  redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  await redis.connect().catch(() => (available = false))
})
afterAll(async () => {
  await redis.quit().catch(() => {})
})
beforeEach(async () => {
  db.clear()
  queued.length = 0
  if (available) await redis.flushdb()
})

const ev = (n: number): TaskEvent => ({ type: "notice", level: "info", message: `e${n}` })

describe("EventLog", () => {
  it("assigns contiguous sequences and queues each event for Postgres", async (ctx) => {
    if (!available) ctx.skip()
    const { EventLog } = await import("../../events/eventLog.js")
    const log = new EventLog()
    const seqs = []
    for (let i = 0; i < 5; i++) seqs.push(await log.append("t1", ev(i)))
    expect(seqs).toEqual([0, 1, 2, 3, 4])
    expect(queued.map((q) => q.seq)).toEqual([0, 1, 2, 3, 4])
    expect(await log.range("t1", 2)).toEqual([ev(2), ev(3), ev(4)])
    expect(await log.length("t1")).toBe(5)
  })

  it("keeps the sequence monotonic after the live list expires (long approval or park)", async (ctx) => {
    if (!available) ctx.skip()
    const { EventLog } = await import("../../events/eventLog.js")
    const log = new EventLog()
    for (let i = 0; i < 3; i++) await log.append("t2", ev(i))
    // Simulate the 24 h list TTL passing (the counter survives).
    await redis.del("events:t2", "pw:evbase:t2")
    expect(await log.append("t2", ev(3))).toBe(3)
    // Replay from the start stitches Postgres (0–2) and the new live list (3).
    expect(await log.range("t2", 0)).toEqual([ev(0), ev(1), ev(2), ev(3)])
    expect(await log.range("t2", 3)).toEqual([ev(3)])
  })

  it("re-seeds the sequence from Postgres when the counter itself is gone", async (ctx) => {
    if (!available) ctx.skip()
    const { EventLog } = await import("../../events/eventLog.js")
    const log = new EventLog()
    for (let i = 0; i < 4; i++) await log.append("t3", ev(i))
    await redis.del("events:t3", "pw:evbase:t3", "pw:evseq:t3") // everything in Redis expired
    expect(await log.append("t3", ev(4))).toBe(4) // continues after max(seq) in Postgres
    expect(await log.range("t3", 0)).toHaveLength(5)
  })

  it("replays a finished task from Postgres when Redis has nothing", async (ctx) => {
    if (!available) ctx.skip()
    db.set("t4", [0, 1].map((seq) => ({ seq, event: ev(seq) })))
    const { EventLog } = await import("../../events/eventLog.js")
    expect(await new EventLog().range("t4", 0)).toEqual([ev(0), ev(1)])
  })

  it("clear() restarts the sequence at 0", async (ctx) => {
    if (!available) ctx.skip()
    const { EventLog } = await import("../../events/eventLog.js")
    const log = new EventLog()
    await log.append("t5", ev(0))
    await log.append("t5", ev(1))
    await log.clear("t5")
    expect(await log.append("t5", ev(9))).toBe(0)
  })
})
