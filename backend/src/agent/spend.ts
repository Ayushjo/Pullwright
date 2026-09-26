import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Redis } from "ioredis"

/**
 * Exact spend metering for every paid LLM call.
 *
 * Every call is priced from real usage and checked against two hard caps *before* it is made:
 *   - per task   (TASK_BUDGET_USD, default $0.15)
 *   - global key (SPEND_HARD_STOP_USD, default $1.80) — protects the operator's own API key.
 * BYOK calls are metered too but only count against the task cap.
 *
 * Counters live in Redis so the API and any number of workers share one truth; a local JSONL
 * ledger keeps an audit trail of every call (model, tokens, cost).
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
}

/** Unknown models are priced pessimistically so the caps still hold. */
const FALLBACK_PRICE: Price = { input: 3.0, cachedInput: 3.0, output: 15.0 }

export function priceFor(model: string): Price {
  if (PRICES[model]) return PRICES[model]
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
  keyOwner: "platform" | "byok"
  provider: string
  model: string
  purpose: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

const K_PLATFORM = "pw:spend:platform"
const kTask = (id: string) => `pw:spend:task:${id}`
const kCalls = (id: string) => `pw:spend:calls:${id}`

export class SpendLedger {
  readonly file: string
  private seeded: Promise<void> | null = null
  // Local mirrors so synchronous readers (UI snapshots) get a recent value without awaiting Redis.
  private platformCache = 0
  private taskCache = new Map<string, number>()

  constructor(
    private redis: Redis | null,
    dir = process.env.SPEND_LEDGER_DIR ?? DEFAULT_LEDGER_DIR,
    readonly hardStopUsd = Number(process.env.SPEND_HARD_STOP_USD ?? 1.8),
    readonly taskCapUsd = Number(process.env.TASK_BUDGET_USD ?? 0.15),
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, "openai-ledger.jsonl")
    for (const e of this.readAll()) {
      if (e.keyOwner === "platform") this.platformCache += e.costUsd
      this.taskCache.set(e.taskId, (this.taskCache.get(e.taskId) ?? 0) + e.costUsd)
    }
  }

  /** First use: make sure Redis knows at least what the local audit ledger already recorded. */
  private seed(): Promise<void> {
    this.seeded ??= (async () => {
      if (!this.redis) return
      const cur = Number((await this.redis.get(K_PLATFORM)) ?? 0)
      if (cur < this.platformCache) await this.redis.set(K_PLATFORM, String(this.platformCache))
      this.platformCache = Math.max(cur, this.platformCache)
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

  /** Throws before a call that could push past either cap. */
  async assertCanSpend(taskId: string, keyOwner: LedgerEntry["keyOwner"], worstCaseUsd: number, taskCapUsd = this.taskCapUsd) {
    await this.seed()
    if (keyOwner === "platform") {
      const spent = await this.platformSpent()
      if (spent + worstCaseUsd > this.hardStopUsd) {
        throw new SpendLimitError(
          "global",
          `Platform key spend $${spent.toFixed(4)} + next call (≤$${worstCaseUsd.toFixed(4)}) would exceed hard stop $${this.hardStopUsd}`,
        )
      }
    }
    const t = await this.taskSpentAsync(taskId)
    if (t + worstCaseUsd > taskCapUsd) {
      throw new SpendLimitError("task", `Task spend $${t.toFixed(4)} + next call (≤$${worstCaseUsd.toFixed(4)}) would exceed task cap $${taskCapUsd}`)
    }
  }

  async record(entry: Omit<LedgerEntry, "ts">): Promise<LedgerEntry> {
    const full: LedgerEntry = { ts: new Date().toISOString(), ...entry }
    appendFileSync(this.file, JSON.stringify(full) + "\n")
    this.taskCache.set(entry.taskId, this.taskSpent(entry.taskId) + entry.costUsd)
    if (entry.keyOwner === "platform") this.platformCache += entry.costUsd
    if (this.redis) {
      await this.seed()
      const m = this.redis.multi()
      if (entry.keyOwner === "platform") m.incrbyfloat(K_PLATFORM, entry.costUsd)
      m.incrbyfloat(kTask(entry.taskId), entry.costUsd).expire(kTask(entry.taskId), 60 * 60 * 24 * 30)
      m.incr(kCalls(entry.taskId)).expire(kCalls(entry.taskId), 60 * 60 * 24 * 30)
      await m.exec()
    }
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
