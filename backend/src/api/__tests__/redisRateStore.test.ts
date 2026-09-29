import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Redis } from "ioredis"
import { RedisRateStore } from "../redisRateStore.js"

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/12"
let redis: Redis
let available = true
beforeAll(async () => {
  redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  await redis.connect().catch(() => (available = false))
  if (available) await redis.flushdb()
})
afterAll(async () => {
  await redis.quit().catch(() => {})
})

describe("RedisRateStore", () => {
  it("shares one count across store instances (API replicas) and expires with the window", async (ctx) => {
    if (!available) ctx.skip()
    const a = new RedisRateStore("tasks", redis)
    const b = new RedisRateStore("tasks", redis)
    a.init({ windowMs: 60_000 } as never)
    b.init({ windowMs: 60_000 } as never)
    expect((await a.increment("u1")).totalHits).toBe(1)
    expect((await b.increment("u1")).totalHits).toBe(2) // another replica sees the same counter
    expect((await a.get("u1"))?.totalHits).toBe(2)
    const ttl = await redis.pttl("pw:rl:tasks:u1")
    expect(ttl).toBeGreaterThan(50_000)
    await a.resetKey("u1")
    expect(await a.get("u1")).toBeUndefined()
  })
})
