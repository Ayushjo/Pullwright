import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { Redis } from "ioredis"
import { QuotaTracker, dayWindow } from "../quota.js"

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/11"
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

const NOW = Date.UTC(2026, 8, 29, 12, 0, 30) // 12:00:30 UTC

describe("QuotaTracker", () => {
  it("parallel reservations on one free key can't exceed its daily limit (Gemini Flash: 20/day)", async (ctx) => {
    if (!available) ctx.skip()
    const q = new QuotaTracker(redis)
    const results = await Promise.all(Array.from({ length: 30 }, () => q.reserve("u1:gemini|gemini-3.8-flash", 1000, { rpd: 20, rpm: 100 }, "pt_midnight", NOW)))
    expect(results.filter((r) => r.ok)).toHaveLength(20)
    const miss = results.find((r) => !r.ok)
    expect(miss).toMatchObject({ ok: false, reason: "rpd" })
  })

  it("rejects a request above the per-request cap without booking it (Groq free: 8K)", async (ctx) => {
    if (!available) ctx.skip()
    const q = new QuotaTracker(redis)
    expect(await q.reserve("g|oss", 12_600, { tpm: 8000, maxRequestTokens: 8000 }, "rolling", NOW)).toMatchObject({ ok: false, reason: "too_large" })
    expect(await q.reserve("g|oss", 6000, { tpm: 8000, maxRequestTokens: 8000 }, "rolling", NOW)).toEqual({ ok: true })
    const tpm = await q.reserve("g|oss", 3000, { tpm: 8000, maxRequestTokens: 8000 }, "rolling", NOW)
    expect(tpm).toMatchObject({ ok: false, reason: "tpm" })
    expect((tpm as { retryInMs: number }).retryInMs).toBe(30_000) // rest of the current minute (12:00:30)
  })

  it("cooldowns block the lane until they lapse and never get shortened", async (ctx) => {
    if (!available) ctx.skip()
    const q = new QuotaTracker(redis)
    await q.cooldown("s", 60_000)
    await q.cooldown("s", 1_000) // shorter: ignored
    const r = await q.reserve("s", 10, {}, "rolling", NOW)
    expect(r).toMatchObject({ ok: false, reason: "cooldown" })
    expect((r as { retryInMs: number }).retryInMs).toBeGreaterThan(55_000)
  })

  it("learned limits override the seeds", async (ctx) => {
    if (!available) ctx.skip()
    const q = new QuotaTracker(redis)
    await q.learn("s2", { rpd: 2 })
    expect((await q.reserve("s2", 1, { rpd: 500 }, "utc_midnight", NOW)).ok).toBe(true)
    expect((await q.reserve("s2", 1, { rpd: 500 }, "utc_midnight", NOW)).ok).toBe(true)
    expect(await q.reserve("s2", 1, { rpd: 500 }, "utc_midnight", NOW)).toMatchObject({ ok: false, reason: "rpd" })
  })
})

describe("dayWindow", () => {
  it("midnight Pacific, DST-aware", () => {
    // 2026-09-29 12:00 UTC = 05:00 PDT → 19 h to midnight PT
    expect(dayWindow("pt_midnight", Date.UTC(2026, 8, 29, 12)).msToEnd).toBe(19 * 3_600_000)
    // 2026-12-01 12:00 UTC = 04:00 PST → 20 h to midnight PT
    expect(dayWindow("pt_midnight", Date.UTC(2026, 11, 1, 12)).msToEnd).toBe(20 * 3_600_000)
    expect(dayWindow("utc_midnight", Date.UTC(2026, 8, 29, 18)).msToEnd).toBe(6 * 3_600_000)
  })
})

describe("QuotaTracker.status", () => {
  it("reports used vs limit per window, cooldown and the day reset", async (ctx) => {
    if (!available) ctx.skip()
    const q = new QuotaTracker(redis)
    const seed = { rpm: 15, rpd: 500 }
    await q.reserve("platform:gemini|gemini-3.5-flash-lite", 1000, seed, "pt_midnight")
    await q.reserve("platform:gemini|gemini-3.5-flash-lite", 1000, seed, "pt_midnight")
    await q.cooldown("platform:gemini|gemini-3.5-flash-lite", 5000)
    const st = await q.status("platform:gemini|gemini-3.5-flash-lite", seed, "pt_midnight")
    expect(st.rpd).toEqual({ used: 2, limit: 500 })
    expect(st.rpm.used).toBe(2)
    expect(st.tpd.used).toBe(2000)
    expect(st.cooldownMs).toBeGreaterThan(4000)
    expect(Date.parse(st.dayResetAt) - Date.now()).toBeLessThanOrEqual(86_400_000)
  })
})
