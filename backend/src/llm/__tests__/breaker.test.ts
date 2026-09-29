import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { Redis } from "ioredis"
import { CircuitBreaker } from "../breaker.js"

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/10"
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

describe("CircuitBreaker", () => {
  it("opens only when three different keys fail on the same model", async (ctx) => {
    if (!available) ctx.skip()
    const b = new CircuitBreaker(redis)
    const m = "gemini/gemini-3.8-flash"
    expect(await b.failure(m, "userA")).toBe(false)
    expect(await b.failure(m, "userA")).toBe(false) // same key twice counts once
    expect(await b.failure(m, "userB")).toBe(false)
    expect(await b.failure(m, "userC")).toBe(true)
    const s = await b.isOpen(m)
    expect(s.open).toBe(true)
    expect(s.retryInMs).toBeGreaterThan(55_000)
    expect((await b.isOpen("gemini/gemini-3.6-flash")).open).toBe(false) // other models unaffected
  })

  it("backs off longer on repeated outages and resets after a success", async (ctx) => {
    if (!available) ctx.skip()
    const b = new CircuitBreaker(redis)
    const m = "p/m"
    for (const u of ["a", "b", "c"]) await b.failure(m, u)
    await redis.del("pw:cb:p/m") // first open lapses
    for (const u of ["d", "e", "f"]) await b.failure(m, u)
    expect((await b.isOpen(m)).retryInMs).toBeGreaterThan(115_000) // second open: 120 s
    await b.success(m)
    await redis.del("pw:cb:p/m")
    for (const u of ["g", "h", "i"]) await b.failure(m, u)
    expect((await b.isOpen(m)).retryInMs).toBeLessThanOrEqual(60_000) // streak reset
  })
})
