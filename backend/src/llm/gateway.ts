import { chat, type CallOptions, type LLMResult, type ModelSpec } from "../agent/llm.js"
import { SpendLimitError } from "../agent/spend.js"
import logger from "../logger.js"
import { CircuitBreaker } from "./breaker.js"
import { classifyError, type ErrorClass } from "./errors.js"
import { dayWindow, QuotaTracker } from "./quota.js"
import { PROVIDERS, seedLimits, supportsVision, type ProviderId } from "./registry.js"

/**
 * The model gateway: one logical call, tried across an ordered list of lanes (credential × model)
 * with quota reservation, circuit breaking and failover. Lanes are ordered by the caller (policy:
 * spend order, role, quality); the gateway only decides "can this lane serve right now".
 */

export type Lane = {
  /** e.g. "platform:gemini", "user:<id>:openrouter" — the quota/credential identity. */
  credentialId: string
  ownerUserId: string | null
  provider: ProviderId
  model: string
  apiKey?: string
  spendClass: NonNullable<ModelSpec["spendClass"]>
  reasoningEffort?: ModelSpec["reasoningEffort"]
  /** Per-lane timeout (free endpoints can hang > 90 s). */
  timeoutMs?: number
}

export type Attempt = { lane: string; outcome: "ok" | "skipped" | ErrorClass | "quota" | "breaker"; detail?: string; retryInMs?: number }

export class NoLaneAvailable extends Error {
  constructor(
    /** Earliest time a lane may serve again; null = needs action (new key, credits, …). */
    readonly retryAt: number | null,
    readonly attempts: Attempt[],
  ) {
    super(retryAt ? `No model lane available until ${new Date(retryAt).toISOString()}` : "No model lane can serve this request")
    this.name = "NoLaneAvailable"
  }
}

export type Send = (spec: ModelSpec, opts: CallOptions) => Promise<LLMResult>
export type GatewayResult = LLMResult & { lane: Lane; attempts: Attempt[] }

export const laneId = (l: Lane) => `${l.credentialId}|${l.model}`
const HOUR = 3_600_000

/** How long to keep a lane out after each error class (retry hints win when the provider gives one). */
function cooldownFor(cls: ErrorClass, lane: Lane, retryAfterMs: number | undefined): number {
  switch (cls) {
    case "rate_limited":
      return retryAfterMs ?? 20_000
    case "daily_exhausted":
      return retryAfterMs && retryAfterMs > 60_000 ? retryAfterMs : dayWindow(PROVIDERS[lane.provider].dailyReset).msToEnd
    case "overloaded":
    case "timeout":
    case "server":
      return retryAfterMs ?? 10_000
    case "not_allowed":
    case "model_gone":
      return 24 * HOUR
    case "auth_revoked":
    case "out_of_funds":
      return HOUR
    default:
      return 0 // too_large, policy_blocked, bad_request, signature: this request only
  }
}

const OUTAGE: ReadonlySet<ErrorClass> = new Set(["overloaded", "timeout", "server"])

export class Gateway {
  constructor(
    readonly quota: QuotaTracker,
    private breaker: CircuitBreaker,
    private send: Send = chat,
    private opts: { maxLanesTried?: number; inlineWaitMs?: number; rounds?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  async complete(lanes: Lane[], call: CallOptions): Promise<GatewayResult> {
    const rounds = this.opts.rounds ?? 3
    // Per-minute limits answer with Retry-After up to 60 s (Vercel free tier: 5 RPM per model, "Retry after 60s").
    const inlineWait = this.opts.inlineWaitMs ?? 65_000
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    const attempts: Attempt[] = []
    for (let round = 1; ; round++) {
      const out = await this.round(lanes, call, attempts)
      if (out.result) return { ...out.result, attempts }
      if (out.lastHardError && out.waitMs === null) throw out.lastHardError
      // Everything is briefly blocked (per-minute limits, a short cooldown): wait here instead of failing.
      if (out.waitMs !== null && out.waitMs <= inlineWait && round < rounds) {
        await sleep(Math.max(250, out.waitMs))
        continue
      }
      throw new NoLaneAvailable(out.waitMs === null ? null : Date.now() + out.waitMs, attempts)
    }
  }

  private async round(lanes: Lane[], call: CallOptions, attempts: Attempt[]) {
    const est = estimateTokens(call)
    let waitMs: number | null = null
    let lastHardError: unknown = null
    let tried = 0
    const wait = (ms: number) => (waitMs = waitMs === null ? ms : Math.min(waitMs, ms))
    for (const lane of lanes) {
      if (tried >= (this.opts.maxLanesTried ?? 4)) break
      const id = laneId(lane)
      const pm = `${lane.provider}/${lane.model}`
      const br = await this.breaker.isOpen(pm)
      if (br.open) {
        attempts.push({ lane: id, outcome: "breaker", retryInMs: br.retryInMs })
        wait(br.retryInMs)
        continue
      }
      // Seed limits describe free tiers (incl. free-credit grants); paid lanes rely on learned limits and 429s.
      const seed = lane.spendClass === "free" || lane.spendClass === "free_credit" ? seedLimits(lane.provider, lane.model) : {}
      // Per-request caps (Groq free: prompt + max output ≤ 8K): shrink the output budget to fit, fall back
      // to the call's compact rendering if it has one, otherwise skip the lane.
      let maxOut = call.maxOutputTokens
      let laneMessages = call.messages
      let laneEst = est
      if (seed.maxRequestTokens) {
        let room = seed.maxRequestTokens - laneEst - 200
        if (room < 1024 && call.compact) {
          laneMessages = call.compact
          laneEst = estimateTokens({ messages: call.compact, ...(call.tools ? { tools: call.tools } : {}) })
          room = seed.maxRequestTokens - laneEst - 200
        }
        if (room < 1024) {
          attempts.push({ lane: id, outcome: "skipped", detail: `prompt ≈${laneEst} tokens exceeds the ${seed.maxRequestTokens}-token request cap` })
          continue
        }
        maxOut = Math.min(maxOut, room)
      }
      const scope = id
      const reset = PROVIDERS[lane.provider].dailyReset
      const q = await this.quota.reserve(scope, laneEst + maxOut, seed, reset)
      if (!q.ok) {
        attempts.push({ lane: id, outcome: "quota", detail: q.reason, retryInMs: q.retryInMs })
        if (q.retryInMs >= 0) wait(q.retryInMs)
        continue
      }
      tried++
      const spec: ModelSpec = {
        provider: lane.provider,
        model: lane.model,
        spendClass: lane.spendClass,
        ...(lane.apiKey ? { apiKey: lane.apiKey } : {}),
        ...(lane.reasoningEffort ? { reasoningEffort: lane.reasoningEffort } : {}),
      }
      // Text-only lanes get the attachment transcript instead of pixels (gpt-oss answers 400 to image parts).
      const messages = supportsVision(lane.provider, lane.model) ? laneMessages : withoutImages(laneMessages)
      try {
        const { compact: _c, ...rest } = call
        const result = await this.send(spec, { ...rest, messages, maxOutputTokens: maxOut, attempts: 1, timeoutMs: lane.timeoutMs ?? call.timeoutMs ?? 90_000 })
        await this.quota.reconcile(scope, laneEst + maxOut, result.inputTokens + result.outputTokens, reset).catch(() => {})
        await this.breaker.success(pm).catch(() => {})
        attempts.push({ lane: id, outcome: "ok", ...(laneMessages !== call.messages ? { detail: "compact rendering" } : {}) })
        return { result: { ...result, lane }, waitMs, lastHardError }
      } catch (err) {
        if (err instanceof SpendLimitError) throw err // budget decisions are final, not a lane problem
        const c = classifyError(err)
        const cool = cooldownFor(c.cls, lane, c.retryAfterMs)
        attempts.push({ lane: id, outcome: c.cls, detail: c.message.slice(0, 200), ...(cool ? { retryInMs: cool } : {}) })
        logger.warn(`lane ${id} failed (${c.cls}): ${c.message.slice(0, 160)}`)
        if (cool) {
          await this.quota.cooldown(scope, cool)
          if (c.cls !== "not_allowed" && c.cls !== "model_gone" && c.cls !== "auth_revoked" && c.cls !== "out_of_funds") wait(cool)
        }
        if (OUTAGE.has(c.cls)) await this.breaker.failure(pm, lane.credentialId).catch(() => false)
        if (!cool) lastHardError = err
      }
    }
    return { result: null, waitMs, lastHardError }
  }
}

/** Replace image parts with a note; messages without images are returned as they are. */
export function withoutImages(messages: CallOptions["messages"]): CallOptions["messages"] {
  let changed = false
  const out = messages.map((m) => {
    if (!Array.isArray(m.content)) return m
    const parts = m.content as { type: string }[]
    if (!parts.some((p) => p.type === "image_url")) return m
    changed = true
    return { ...m, content: parts.map((p) => (p.type === "image_url" ? { type: "text", text: "[image omitted for this model — see the attachment transcript]" } : p)) } as typeof m
  })
  return changed ? out : messages
}

/**
 * Tokens one image costs, upper end of what we measured (probe-vision, 2026-09-29): gpt-5-mini 751 at
 * 800 px and 3,001 at 1600 px, Gemini Flash-Lite 1,089, Groq qwen3.8-27b 1,282 (Groq caps at 2,048).
 */
export const IMAGE_TOKENS = 3_000

/** Prompt size estimate (chars/3.5 incl. tool schemas; images at a flat IMAGE_TOKENS, not their base64 size). */
export function estimateTokens(call: Pick<CallOptions, "messages" | "tools">): number {
  let images = 0
  const json = JSON.stringify(call.messages, (key, value) => {
    if (value && typeof value === "object" && (value as { type?: string }).type === "image_url") {
      images++
      return { type: "image_url" }
    }
    return value
  })
  let chars = json.length
  if (call.tools) chars += JSON.stringify(call.tools).length
  return Math.ceil(chars / 3.5) + images * IMAGE_TOKENS
}
