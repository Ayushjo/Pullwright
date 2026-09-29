import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import { mkdtempSync } from "fs"
import os from "os"
import path from "path"
import { Redis } from "ioredis"

/** Real Redis (db 13) so the reservation script is exercised; Postgres rows are captured in memory. */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/13"
const rows: { costUsd: number; keyOwner: string }[] = []
vi.mock("../../repositories/llmCallRepository.js", () => ({
  queueLlmCall: (r: { costUsd: number; keyOwner: string }) => rows.push(r),
  sumPlatformSpend: async () => 0,
}))

const { SpendLedger, SpendLimitError } = await import("../spend.js")

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
  rows.length = 0
  if (available) await redis.flushdb()
})

const dir = () => mkdtempSync(path.join(os.tmpdir(), "pw-spend-"))
const entry = (taskId: string, costUsd: number, keyOwner: "platform" | "byok" = "platform") => ({
  taskId, keyOwner, provider: "openai", model: "gpt-5-mini", purpose: "run", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, costUsd,
})

describe("SpendLedger reservations", () => {
  it("parallel calls cannot jointly overshoot the task cap", async (ctx) => {
    if (!available) ctx.skip()
    const l = new SpendLedger(redis, dir(), 100, 0.1)
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => l.reserve("t1", "platform", 0.03)))
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3) // 3 × 0.03 ≤ 0.10 < 4 × 0.03
    expect(results.find((r) => r.status === "rejected")?.reason).toBeInstanceOf(SpendLimitError)
  })

  it("recording the actual cost frees the hold and counts only what was spent", async (ctx) => {
    if (!available) ctx.skip()
    const l = new SpendLedger(redis, dir(), 100, 0.1)
    const h = await l.reserve("t2", "platform", 0.09)
    await expect(l.reserve("t2", "platform", 0.02)).rejects.toThrow(/task cap/)
    await l.record(entry("t2", 0.01), h)
    expect(await l.taskSpentAsync("t2")).toBeCloseTo(0.01)
    await expect(l.reserve("t2", "platform", 0.05)).resolves.toBeTruthy()
    expect(rows).toHaveLength(1) // durable llm_calls row queued
  })

  it("enforces the monthly platform budget but not for BYOK calls", async (ctx) => {
    if (!available) ctx.skip()
    const l = new SpendLedger(redis, dir(), 100, 10, 0.05)
    await l.record(entry("t3", 0.04))
    await expect(l.reserve("t4", "platform", 0.02)).rejects.toThrow(/monthly budget/)
    await expect(l.reserve("t4", "byok", 0.02)).resolves.toBeTruthy()
    expect(await l.platformSpentThisMonth()).toBeCloseTo(0.04)
  })

  it("holds from a crashed caller lapse after their TTL", async (ctx) => {
    if (!available) ctx.skip()
    const l = new SpendLedger(redis, dir(), 100, 0.1)
    await l.reserve("t5", "platform", 0.09) // never released
    const members = await redis.zrange("pw:hold:task:t5", 0, -1)
    await redis.zadd("pw:hold:task:t5", Date.now() - 1, members[0]!) // pretend it expired
    await expect(l.reserve("t5", "platform", 0.09)).resolves.toBeTruthy()
  })
})
