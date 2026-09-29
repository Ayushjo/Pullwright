import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Redis } from "ioredis"
import { randomUUID } from "crypto"
import { queueLlmCall, sumPlatformSpend } from "../repositories/llmCallRepository.js"

/**
 * Exact spend metering for every paid LLM call.
 *
 * Every call is priced from real usage and checked against the caps *before* it is made:
 *   - per task   (TASK_BUDGET_USD, default $0.15, scaled per task)
 *   - operator key, lifetime (SPEND_HARD_STOP_USD) and per month (PLATFORM_MONTHLY_BUDGET_USD)
 * BYOK calls are metered too but only count against the task cap. The check reserves the call's
 * worst case atomically (Lua), so calls already in flight count too.
 *
 * Counters live in Redis so the API and any number of workers share one truth. Every call is also
 * a row in llm_calls (the durable record), and a local JSONL keeps a per-process audit trail.
 */

export type Price = { input: number; cachedInput: number; output: number } // USD per 1M tokens

// Standard-tier list prices (developers.openai.com/api/docs/pricing, fetched 2026-09-27).
export const PRICES: Record<string, Price> = {
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15.0 },
  // Anthropic (BYOK) — cached reads are 10% of input.
  "claude-haiku-4-5": { input: 1.0, cachedInput: 0.1, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, cachedInput: 0.2, output: 10.0 },
  // Cheap candidates via Vercel AI Gateway (ai-gateway.vercel.sh/v1/models, fetched 2026-09-29).
  // Temporary until the phase-1 catalog syncs prices per route.
  "deepseek-v4-flash-0731": { input: 0.076, cachedInput: 0.014, output: 0.153 },
  "glm-5.3-flash": { input: 0.15, cachedInput: 0.03, output: 0.5 },
}

/** Unknown models are priced pessimistically so the caps still hold. */
const FALLBACK_PRICE: Price = { input: 3.0, cachedInput: 3.0, output: 15.0 }

export function priceFor(model: string): Price {
  model = model.replace(/^[a-z0-9-]+\//, "") // gateway ids are vendor/model, e.g. openai/gpt-5-mini, deepseek/…
  const exact = PRICES[model]
  if (exact) return exact
  const base = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k))
  return base ? PRICES[base]! : FALLBACK_PRICE
}

export type TokenUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number }

export function costOf(model: string, u: TokenUsage): number {
  const p = priceFor(model)
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens)
  return (uncached * p.input + u.cachedInputTokens * p.cachedInput + u.outputTokens * p.output) / 1_000_000
}

export class SpendLimitError extends Error {
  constructor(readonly scope: "task" | "global", message: string) {
    super(message)
    this.name = "SpendLimitError"
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_LEDGER_DIR = path.resolve(__dirname, "../../.spend")

export type LedgerEntry = {
  ts: string
  taskId: string
  /** platform = the operator's own key (counts against the platform caps); byok = the user's key;
   *  free_credit = a provider's free monthly credit (e.g. Vercel AI Gateway) — task cap only. */
  keyOwner: "platform" | "byok" | "free_credit"
  provider: string
  model: string
  purpose: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

const K_PLATFORM = "pw:spend:platform"
const kMonth = (d = new Date()) => `pw:spend:platform:${d.toISOString().slice(0, 7)}`
const kTask = (id: string) => `pw:spend:task:${id}`
const kCalls = (id: string) => `pw:spend:calls:${id}`
const kHoldZ = (scope: string) => `pw:hold:${scope}` // zset holdId → expiresAt
const kHoldH = (scope: string) => `pw:holdamt:${scope}` // hash holdId → amount
const TASK_TTL = 60 * 60 * 24 * 30
const HOLD_TTL_MS = 10 * 60_000 // a call never runs this long; a crashed worker's holds lapse

/**
 * Check caps and reserve the worst case atomically, counting calls already in flight.
 * KEYS: taskSpent, taskHoldZ, taskHoldH, lifetime, month, platHoldZ, platHoldH
 * ARGV: holdId, amount, taskCap, lifetimeCap(-1 = none), monthCap(-1 = none), nowMs, ttlMs, isPlatform(0/1)
 * Returns {1} or {0, scope, alreadyCommitted}.
 */
const RESERVE = `
local function held(z, h, now)
  local gone = redis.call('ZRANGEBYSCORE', z, '-inf', now)
  for _, id in ipairs(gone) do redis.call('HDEL', h, id) end
  redis.call('ZREMRANGEBYSCORE', z, '-inf', now)
  local sum = 0
  for _, v in ipairs(redis.call('HVALS', h)) do sum = sum + tonumber(v) end
  return sum
end
local amount, now, exp = tonumber(ARGV[2]), tonumber(ARGV[6]), tonumber(ARGV[6]) + tonumber(ARGV[7])
local t = tonumber(redis.call('GET', KEYS[1]) or '0') + held(KEYS[2], KEYS[3], now)
if t + amount > tonumber(ARGV[3]) then return {0, 'task', tostring(t)} end
if ARGV[8] == '1' then
  local ph = held(KEYS[6], KEYS[7], now)
  local life = tonumber(redis.call('GET', KEYS[4]) or '0') + ph
  if tonumber(ARGV[4]) >= 0 and life + amount > tonumber(ARGV[4]) then return {0, 'global', tostring(life)} end
  local month = tonumber(redis.call('GET', KEYS[5]) or '0') + ph
  if tonumber(ARGV[5]) >= 0 and month + amount > tonumber(ARGV[5]) then return {0, 'month', tostring(month)} end
  redis.call('ZADD', KEYS[6], exp, ARGV[1]); redis.call('HSET', KEYS[7], ARGV[1], amount)
  redis.call('PEXPIRE', KEYS[6], ARGV[7]); redis.call('PEXPIRE', KEYS[7], ARGV[7])
end
redis.call('ZADD', KEYS[2], exp, ARGV[1]); redis.call('HSET', KEYS[3], ARGV[1], amount)
redis.call('PEXPIRE', KEYS[2], ARGV[7]); redis.call('PEXPIRE', KEYS[3], ARGV[7])
return {1}`

export type Hold = { id: string; taskId: string; keyOwner: LedgerEntry["keyOwner"]; amount: number }

export class SpendLedger {
  readonly file: string
  private seeded: Promise<void> | null = null
  // Local mirrors so synchronous readers (UI snapshots) get a recent value without awaiting Redis.
  private platformCache = 0
  private taskCache = new Map<string, number>()
  // Without Redis (single process, tests): in-flight holds live here.
  private localHolds = new Map<string, Hold>()

  constructor(
    private redis: Redis | null,
    dir = process.env.SPEND_LEDGER_DIR ?? DEFAULT_LEDGER_DIR,
    /** Lifetime stop for the operator's own key (owner's budget rule). */
    readonly hardStopUsd = Number(process.env.SPEND_HARD_STOP_USD ?? 1.8),
    readonly taskCapUsd = Number(process.env.TASK_BUDGET_USD ?? 0.15),
    /** Platform-key budget per calendar month (UTC); unset = no monthly limit. */
    readonly monthlyBudgetUsd = process.env.PLATFORM_MONTHLY_BUDGET_USD ? Number(process.env.PLATFORM_MONTHLY_BUDGET_USD) : Infinity,
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, "openai-ledger.jsonl")
    for (const e of this.readAll()) {
      if (e.keyOwner === "platform") this.platformCache += e.costUsd
      this.taskCache.set(e.taskId, (this.taskCache.get(e.taskId) ?? 0) + e.costUsd)
    }
  }

  /**
   * First use: Redis must know at least what the durable record says. The llm_calls table is the
   * source of truth (shared by every worker); the local JSONL only matters when there is no database.
   * Counters are only ever raised here, never lowered.
   */
  private seed(): Promise<void> {
    this.seeded ??= (async () => {
      if (!this.redis) return
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
      const [dbLife, dbMonth] = await Promise.all([sumPlatformSpend().catch(() => 0), sumPlatformSpend(monthStart).catch(() => 0)])
      const life = Math.max(dbLife, this.platformCache)
      const cur = Number((await this.redis.get(K_PLATFORM)) ?? 0)
      if (cur < life) await this.redis.set(K_PLATFORM, String(life))
      const curMonth = Number((await this.redis.get(kMonth())) ?? 0)
      if (curMonth < dbMonth) await this.redis.set(kMonth(), String(dbMonth), "EX", 40 * 24 * 3600)
      this.platformCache = Math.max(cur, life)
    })()
    return this.seeded
  }

  readAll(): LedgerEntry[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LedgerEntry)
  }

  async platformSpent(): Promise<number> {
    await this.seed()
    if (!this.redis) return this.platformCache
    this.platformCache = Number((await this.redis.get(K_PLATFORM)) ?? 0)
    return this.platformCache
  }

  async platformSpentThisMonth(): Promise<number> {
    await this.seed()
    if (!this.redis) return this.platformCache
    return Number((await this.redis.get(kMonth())) ?? 0)
  }

  async taskSpentAsync(taskId: string): Promise<number> {
    if (!this.redis) return this.taskCache.get(taskId) ?? 0
    const v = Number((await this.redis.get(kTask(taskId))) ?? this.taskCache.get(taskId) ?? 0)
    this.taskCache.set(taskId, v)
    return v
  }

  /** Last known value (sync) — for UI snapshots only, never for enforcement. */
  taskSpent(taskId: string): number {
    return this.taskCache.get(taskId) ?? 0
  }

  async taskCalls(taskId: string): Promise<number> {
    if (!this.redis) return this.readAll().filter((e) => e.taskId === taskId).length
    return Number((await this.redis.get(kCalls(taskId))) ?? 0)
  }

  /**
   * Reserve the worst-case cost of the next call, or throw. The check counts calls already in
   * flight (their holds), so parallel calls can't jointly overshoot a cap. Release or record after.
   */
  async reserve(taskId: string, keyOwner: LedgerEntry["keyOwner"], amountUsd: number, taskCapUsd = this.taskCapUsd): Promise<Hold> {
    await this.seed()
    const hold: Hold = { id: randomUUID(), taskId, keyOwner, amount: amountUsd }
    const platform = keyOwner === "platform"
    if (!this.redis) {
      const inFlight = (pred: (h: Hold) => boolean) => [...this.localHolds.values()].filter(pred).reduce((a, h) => a + h.amount, 0)
      const t = this.taskSpent(taskId) + inFlight((h) => h.taskId === taskId)
      if (t + amountUsd > taskCapUsd) throw this.limitError("task", t, amountUsd, taskCapUsd)
      if (platform) {
        const p = this.platformCache + inFlight((h) => h.keyOwner === "platform")
        if (p + amountUsd > this.hardStopUsd) throw this.limitError("global", p, amountUsd, this.hardStopUsd)
      }
      this.localHolds.set(hold.id, hold)
      return hold
    }
    const cap = (n: number) => (Number.isFinite(n) ? String(n) : "-1")
    const res = (await this.redis.eval(
      RESERVE, 7,
      kTask(taskId), kHoldZ(`task:${taskId}`), kHoldH(`task:${taskId}`), K_PLATFORM, kMonth(), kHoldZ("platform"), kHoldH("platform"),
      hold.id, amountUsd, taskCapUsd, cap(this.hardStopUsd), cap(this.monthlyBudgetUsd), Date.now(), HOLD_TTL_MS, platform ? "1" : "0",
    )) as [number, string?, string?]
    if (Number(res[0]) !== 1) {
      const scope = res[1] as "task" | "global" | "month"
      const limit = scope === "task" ? taskCapUsd : scope === "global" ? this.hardStopUsd : this.monthlyBudgetUsd
      throw this.limitError(scope, Number(res[2]), amountUsd, limit)
    }
    return hold
  }

  async release(hold: Hold): Promise<void> {
    if (!this.redis) {
      this.localHolds.delete(hold.id)
      return
    }
    const m = this.redis.multi().zrem(kHoldZ(`task:${hold.taskId}`), hold.id).hdel(kHoldH(`task:${hold.taskId}`), hold.id)
    if (hold.keyOwner === "platform") m.zrem(kHoldZ("platform"), hold.id).hdel(kHoldH("platform"), hold.id)
    await m.exec()
  }

  private limitError(scope: "task" | "global" | "month", committed: number, next: number, limit: number) {
    const what = scope === "task" ? "Task spend" : scope === "global" ? "Platform key spend" : "Platform spend this month"
    const cap = scope === "task" ? "task cap" : scope === "global" ? "hard stop" : "monthly budget"
    return new SpendLimitError(scope === "task" ? "task" : "global", `${what} $${committed.toFixed(4)} + next call (≤$${next.toFixed(4)}) would exceed ${cap} $${limit}`)
  }

  /** Throws if the next call could push past a cap (check only; nothing is reserved). */
  async assertCanSpend(taskId: string, keyOwner: LedgerEntry["keyOwner"], worstCaseUsd: number, taskCapUsd = this.taskCapUsd) {
    await this.release(await this.reserve(taskId, keyOwner, worstCaseUsd, taskCapUsd))
  }

  /** Record a finished call: counters, audit file, durable row — and drop its hold. */
  async record(entry: Omit<LedgerEntry, "ts">, hold?: Hold, extra?: { userId?: string; durationMs?: number }): Promise<LedgerEntry> {
    const full: LedgerEntry = { ts: new Date().toISOString(), ...entry }
    appendFileSync(this.file, JSON.stringify(full) + "\n")
    this.taskCache.set(entry.taskId, this.taskSpent(entry.taskId) + entry.costUsd)
    if (entry.keyOwner === "platform") this.platformCache += entry.costUsd
    if (this.redis) {
      await this.seed()
      const m = this.redis.multi()
      if (entry.keyOwner === "platform") m.incrbyfloat(K_PLATFORM, entry.costUsd).incrbyfloat(kMonth(), entry.costUsd).expire(kMonth(), 40 * 24 * 3600)
      m.incrbyfloat(kTask(entry.taskId), entry.costUsd).expire(kTask(entry.taskId), TASK_TTL)
      m.incr(kCalls(entry.taskId)).expire(kCalls(entry.taskId), TASK_TTL)
      await m.exec()
    }
    if (hold) await this.release(hold)
    queueLlmCall({ ...entry, createdAt: new Date(full.ts), ...(extra?.userId ? { userId: extra.userId } : {}), ...(extra?.durationMs !== undefined ? { durationMs: extra.durationMs } : {}) })
    return full
  }
}

let singleton: SpendLedger | null = null
let redisFactory: (() => Redis) | null = null
/** Wire Redis in once at startup (kept out of this module to avoid import cycles in tests). */
export function useRedisForSpend(factory: () => Redis) {
  redisFactory = factory
  singleton = null
}
export function getSpendLedger(): SpendLedger {
  singleton ??= new SpendLedger(redisFactory ? redisFactory() : null)
  return singleton
}
