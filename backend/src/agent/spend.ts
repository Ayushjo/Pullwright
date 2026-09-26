import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

/**
 * Exact spend metering for every paid LLM call.
 *
 * Every call is appended to a JSONL ledger (one line per call) and checked against
 * two hard caps before the call is made:
 *   - per task   (TASK_BUDGET_USD, default $0.15)
 *   - global key (SPEND_HARD_STOP_USD, default $1.80) — protects the owner's own API key.
 * BYOK calls are metered too but only count against the task cap.
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
  // dated snapshots, e.g. gpt-5-mini-2025-08-07
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

export class SpendLedger {
  private platformTotal: number
  private taskTotals = new Map<string, number>()
  readonly file: string

  constructor(
    dir = process.env.SPEND_LEDGER_DIR ?? DEFAULT_LEDGER_DIR,
    readonly hardStopUsd = Number(process.env.SPEND_HARD_STOP_USD ?? 1.8),
    readonly taskCapUsd = Number(process.env.TASK_BUDGET_USD ?? 0.15),
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, "openai-ledger.jsonl")
    this.platformTotal = 0
    this.refresh()
  }

  /** Re-read the ledger so several processes (API, worker, eval scripts) share one truth. */
  refresh() {
    this.platformTotal = 0
    this.taskTotals.clear()
    for (const e of this.readAll()) {
      if (e.keyOwner === "platform") this.platformTotal += e.costUsd
      this.taskTotals.set(e.taskId, (this.taskTotals.get(e.taskId) ?? 0) + e.costUsd)
    }
  }

  readAll(): LedgerEntry[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LedgerEntry)
  }

  platformSpent(): number {
    return this.platformTotal
  }

  taskSpent(taskId: string): number {
    return this.taskTotals.get(taskId) ?? 0
  }

  /** Throws before a call that could push past either cap. */
  assertCanSpend(taskId: string, keyOwner: LedgerEntry["keyOwner"], worstCaseUsd: number, taskCapUsd = this.taskCapUsd) {
    this.refresh()
    if (keyOwner === "platform" && this.platformTotal + worstCaseUsd > this.hardStopUsd) {
      throw new SpendLimitError(
        "global",
        `Platform key spend $${this.platformTotal.toFixed(4)} + next call (≤$${worstCaseUsd.toFixed(4)}) would exceed hard stop $${this.hardStopUsd}`,
      )
    }
    const t = this.taskSpent(taskId)
    if (t + worstCaseUsd > taskCapUsd) {
      throw new SpendLimitError(
        "task",
        `Task spend $${t.toFixed(4)} + next call (≤$${worstCaseUsd.toFixed(4)}) would exceed task cap $${taskCapUsd}`,
      )
    }
  }

  record(entry: Omit<LedgerEntry, "ts">): LedgerEntry {
    const full: LedgerEntry = { ts: new Date().toISOString(), ...entry }
    appendFileSync(this.file, JSON.stringify(full) + "\n")
    if (entry.keyOwner === "platform") this.platformTotal += entry.costUsd
    this.taskTotals.set(entry.taskId, this.taskSpent(entry.taskId) + entry.costUsd)
    return full
  }
}

let singleton: SpendLedger | null = null
export function getSpendLedger(): SpendLedger {
  singleton ??= new SpendLedger()
  return singleton
}
