import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { Redis } from "ioredis"
import { admit, admissionKeys, pruneActive, refund, startsUsed, WINDOW_MS } from "../admission.js"

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/7"
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
  if (available) await redis.flushdb()
})

const free = { tasksPerDay: 3, maxActive: 1 }

describe("admission", () => {
  it("30 simultaneous submits with 1 active slot: exactly one gets in", async (ctx) => {
    if (!available) ctx.skip()
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => admit(redis, "u1", `t${i}`, free)))
    expect(results.filter((r) => r.ok).length).toBe(1)
    expect(results.filter((r) => !r.ok && r.reason === "active_limit").length).toBe(29)
  })

  it("3 starts per rolling 24 h, with the next slot when the oldest leaves the window", async (ctx) => {
    if (!available) ctx.skip()
    const t0 = Date.UTC(2026, 9, 3, 10)
    for (let i = 0; i < 3; i++) {
      expect((await admit(redis, "u1", `t${i}`, free, t0 + i * 60_000)).ok).toBe(true)
      await redis.srem(admissionKeys.active("u1"), `t${i}`) // task finished: its active slot is released
    }
    const fourth = await admit(redis, "u1", "t3", free, t0 + 3 * 60_000)
    expect(fourth).toEqual({ ok: false, reason: "daily_limit", nextSlotAt: t0 + WINDOW_MS })
    expect(await startsUsed(redis, "u1", t0 + 3 * 60_000)).toBe(3)
    // 24 h after the first start, one slot opens again.
    expect((await admit(redis, "u1", "t4", free, t0 + WINDOW_MS + 1)).ok).toBe(true)
  })

  it("a start that never ran is refunded; stale active entries are pruned", async (ctx) => {
    if (!available) ctx.skip()
    expect((await admit(redis, "u1", "a", free)).ok).toBe(true)
    await refund(redis, "u1", "a")
    expect(await startsUsed(redis, "u1")).toBe(0)
    expect((await admit(redis, "u1", "b", free)).ok).toBe(true)
    expect((await admit(redis, "u1", "c", free))).toEqual({ ok: false, reason: "active_limit" })
    await pruneActive(redis, "u1", async (id) => id !== "b") // b finished (or its state expired)
    expect((await admit(redis, "u1", "c", free)).ok).toBe(true)
  })

  it("limits are per user", async (ctx) => {
    if (!available) ctx.skip()
    expect((await admit(redis, "u1", "x", free)).ok).toBe(true)
    expect((await admit(redis, "u2", "y", free)).ok).toBe(true)
  })
})
