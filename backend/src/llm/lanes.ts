import { createRedisClient } from "../config/redis.js"
import type { CallOptions, LLMResult, ModelSpec } from "../agent/llm.js"
import { CircuitBreaker } from "./breaker.js"
import { Gateway, type Lane } from "./gateway.js"
import { QuotaTracker } from "./quota.js"
import { PROVIDERS, type ProviderId } from "./registry.js"

/** A function the agent loop / reviewer call instead of a fixed model. */
export type ChatFn = (opts: CallOptions) => Promise<LLMResult>

let gateway: Gateway | null = null
export function getGateway(): Gateway {
  if (!gateway) {
    const redis = createRedisClient()
    gateway = new Gateway(new QuotaTracker(redis), new CircuitBreaker(redis))
  }
  return gateway
}

/** Who pays for a platform lane on this provider/model. */
function platformSpendClass(provider: ProviderId, model: string): Lane["spendClass"] {
  if (provider === "vercel") return "free_credit"
  if (provider === "gemini" || provider === "groq") return "free" // the operator's free-tier keys
  if (provider === "openrouter" && model.endsWith(":free")) return "free"
  return "platform"
}

/**
 * "vercel:openai/gpt-5-mini, gemini:gemini-3.5-flash-lite" → lanes on the platform's own keys,
 * in the given order. Unknown providers or providers without a configured key are dropped.
 */
export function parseLanes(spec: string | undefined, effort?: ModelSpec["reasoningEffort"]): Lane[] {
  if (!spec?.trim()) return []
  const out: Lane[] = []
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(":")
    if (i < 0) continue
    const provider = part.slice(0, i).trim() as ProviderId
    const model = part.slice(i + 1).trim()
    const desc = PROVIDERS[provider]
    if (!desc || !model || !desc.platformKeyEnv || !process.env[desc.platformKeyEnv]) continue
    out.push({
      credentialId: `platform:${provider}`,
      ownerUserId: null,
      provider,
      model,
      spendClass: platformSpendClass(provider, model),
      ...(effort ? { reasoningEffort: effort } : {}),
    })
  }
  return out
}

/** A single-lane list for a fixed model spec (the default, and BYOK tasks). */
export function laneFromSpec(spec: ModelSpec, ownerUserId: string | null = null): Lane {
  return {
    credentialId: spec.apiKey ? `user:${ownerUserId ?? "?"}:${spec.provider}` : `platform:${spec.provider}`,
    ownerUserId,
    provider: spec.provider,
    model: spec.model,
    spendClass: spec.spendClass ?? (spec.apiKey ? "byok" : platformSpendClass(spec.provider, spec.model)),
    ...(spec.apiKey ? { apiKey: spec.apiKey } : {}),
    ...(spec.reasoningEffort ? { reasoningEffort: spec.reasoningEffort } : {}),
  }
}

export function chatVia(lanes: Lane[]): ChatFn {
  return (opts) => getGateway().complete(lanes, opts)
}
