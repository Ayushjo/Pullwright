import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { Redis } from "ioredis"

/** Fake providers + real Redis (db 9) for quota/breaker state. */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/9"
vi.mock("../../agent/spend.js", () => ({ SpendLimitError: class SpendLimitError extends Error {} }))
vi.mock("../../agent/llm.js", () => ({ chat: vi.fn() }))

const { Gateway, NoLaneAvailable } = await import("../gateway.js")
const { QuotaTracker } = await import("../quota.js")
const { CircuitBreaker } = await import("../breaker.js")
const { SpendLimitError } = await import("../../agent/spend.js")
type Lane = import("../gateway.js").Lane

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

const lane = (provider: Lane["provider"], model: string, spendClass: Lane["spendClass"] = "platform", cred = `platform:${provider}`): Lane => ({
  credentialId: cred, ownerUserId: null, provider, model, spendClass,
})
const ok = { text: "done", toolCalls: [], finishReason: "stop", costUsd: 0, inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, durationMs: 5 }
const call = (chars = 400) => ({ taskId: "t", purpose: "run", messages: [{ role: "user" as const, content: "x".repeat(chars) }], maxOutputTokens: 10_000 })
const apiErr = (status: number, message: string, headers: Record<string, string> = {}) => Object.assign(new Error(message), { status, error: { message }, headers })
const gw = (send: (spec: { provider: string; model: string }, opts: { maxOutputTokens: number }) => Promise<typeof ok>, o = {}) =>
  new Gateway(new QuotaTracker(redis), new CircuitBreaker(redis), send as never, { sleep: async () => {}, ...o })

describe("Gateway", () => {
  it("fails over when the first lane is overloaded (Gemini 503 'high demand')", async (ctx) => {
    if (!available) ctx.skip()
    const seen: string[] = []
    const g = gw(async (spec) => {
      seen.push(spec.model)
      if (spec.model === "gemini-3.8-flash") throw apiErr(503, "This model is currently experiencing high demand.")
      return ok
    })
    const r = await g.complete([lane("gemini", "gemini-3.8-flash", "free"), lane("gemini", "gemini-3.6-flash", "free")], call())
    expect(seen).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"])
    expect(r.lane.model).toBe("gemini-3.6-flash")
    expect(r.attempts.map((a) => a.outcome)).toEqual(["overloaded", "ok"])
  })

  it("waits inline for a short rate limit on its only lane, then succeeds", async (ctx) => {
    if (!available) ctx.skip()
    let n = 0
    const g = gw(async () => {
      if (n++ === 0) throw apiErr(429, "Rate limit reached", { "retry-after-ms": "300" })
      return ok
    }, { sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)) })
    const r = await g.complete([lane("openai", "gpt-5-mini")], call())
    expect(r.text).toBe("done")
    expect(n).toBe(2)
  })

  it("Groq's 8K request cap: skips a lane the prompt can't fit, shrinks the output budget otherwise", async (ctx) => {
    if (!available) ctx.skip()
    const outs: Record<string, number> = {}
    const g = gw(async (spec, opts) => {
      outs[spec.model] = opts.maxOutputTokens
      return ok
    })
    const groq = lane("groq", "openai/gpt-oss-120b", "free")
    const big = await g.complete([groq, lane("gemini", "gemini-3.5-flash-lite", "free")], call(40_000)) // ≈11.4K tokens
    expect(big.lane.provider).toBe("gemini")
    expect(big.attempts[0]).toMatchObject({ outcome: "skipped" })
    const small = await g.complete([groq], call(7_000)) // ≈2K tokens
    expect(small.lane.provider).toBe("groq")
    expect(outs["openai/gpt-oss-120b"]).toBeLessThanOrEqual(8000 - 2000 - 200 + 10)
  })

  it("a revoked key is skipped on later calls without being retried", async (ctx) => {
    if (!available) ctx.skip()
    let calls = 0
    const g = gw(async (spec) => {
      calls++
      if (spec.provider === "openrouter") throw apiErr(401, "No auth credentials found")
      return ok
    })
    const lanes = [lane("openrouter", "openai/gpt-5-mini", "byok", "user:u1:openrouter"), lane("vercel", "openai/gpt-5-mini", "free_credit")]
    await g.complete(lanes, call())
    await g.complete(lanes, call())
    expect(calls).toBe(3) // 401 once, then the revoked lane stays out
  })

  it("everything exhausted for the day → NoLaneAvailable with the next reset time", async (ctx) => {
    if (!available) ctx.skip()
    const g = gw(async () => {
      throw apiErr(429, "Quota exceeded … GenerateRequestsPerDayPerProjectPerModel-FreeTier")
    })
    const err = await g.complete([lane("gemini", "gemini-3.8-flash", "free")], call()).catch((e) => e)
    expect(err).toBeInstanceOf(NoLaneAvailable)
    expect((err as InstanceType<typeof NoLaneAvailable>).retryAt! - Date.now()).toBeGreaterThan(60_000)
  })

  it("a lane the key may not use (Vercel free tier) needs action: retryAt is null", async (ctx) => {
    if (!available) ctx.skip()
    const g = gw(async () => {
      throw apiErr(403, "Free tier users do not have access to this model.")
    })
    const err = await g.complete([lane("vercel", "deepseek/deepseek-v4-flash", "free_credit")], call()).catch((e) => e)
    expect(err).toBeInstanceOf(NoLaneAvailable)
    expect((err as InstanceType<typeof NoLaneAvailable>).retryAt).toBeNull()
  })

  it("budget errors are final, not a reason to try another lane", async (ctx) => {
    if (!available) ctx.skip()
    let calls = 0
    const g = gw(async () => {
      calls++
      throw new SpendLimitError("Task spend would exceed task cap")
    })
    await expect(g.complete([lane("openai", "gpt-5-mini"), lane("vercel", "openai/gpt-5-mini", "free_credit")], call())).rejects.toBeInstanceOf(SpendLimitError)
    expect(calls).toBe(1)
  })
})
