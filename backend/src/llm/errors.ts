/**
 * Classify a provider error into what the gateway should do about it. Every failover decision
 * depends on this, so the matchers are tested against real error bodies captured from Groq,
 * Gemini, OpenRouter and Vercel (see __tests__/errors.test.ts).
 */

export type ErrorClass =
  | "rate_limited" // back off this lane for retryAfterMs, try the next lane
  | "daily_exhausted" // this lane is done until its daily reset
  | "too_large" // request exceeds this lane's per-request / context limit
  | "overloaded" // provider-side capacity (503 "high demand", 502, 529)
  | "timeout"
  | "auth_revoked" // 401 / 403 on the key itself
  | "out_of_funds" // 402 / insufficient_quota / negative balance
  | "not_allowed" // key valid but this model isn't available to it (e.g. free tier)
  | "policy_blocked" // gateway found no upstream meeting our privacy/parameter requirements
  | "model_gone" // model removed / not available to new users
  | "signature" // Gemini thought signature missing
  | "bad_request"
  | "server"

export type Classified = { cls: ErrorClass; retryAfterMs?: number; message: string }

type ErrLike = { status?: number; code?: string; message?: string; error?: unknown; headers?: Headers | Record<string, string> }

function header(err: ErrLike, name: string): string | null {
  const h = err.headers
  if (!h) return null
  return (h instanceof Headers ? h.get(name) : (h[name] ?? h[name.toLowerCase()])) ?? null
}

/** "1m26.4s", "697ms", "34s", "2.5" (seconds) → ms */
export function parseDuration(s: string): number | undefined {
  let ms = 0
  let matched = false
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)?/g)) {
    matched = true
    const v = Number(n)
    ms += unit === "ms" ? v : unit === "h" ? v * 3_600_000 : unit === "m" ? v * 60_000 : v * 1000
  }
  return matched ? Math.round(ms) : undefined
}

function retryAfter(err: ErrLike, body: string): number | undefined {
  const ms = Number(header(err, "retry-after-ms"))
  if (Number.isFinite(ms) && ms > 0) return ms
  const ra = header(err, "retry-after")
  if (ra) {
    const sec = Number(ra)
    if (Number.isFinite(sec)) return sec * 1000
    const date = Date.parse(ra)
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }
  // Gemini: "retryDelay": "34s" in RetryInfo; Groq: "Please try again in 1m26.4s"; Vercel: "Retry after 60s."
  const gem = body.match(/"retryDelay"\s*:\s*"([^"]+)"/)
  if (gem) return parseDuration(gem[1]!)
  const text = body.match(/(?:try again|retry) (?:in|after) ([0-9hms.]+?)\.?(?:\s|$|")/i)
  if (text) return parseDuration(text[1]!)
  return undefined
}

export function classifyError(err: unknown): Classified {
  const e = (err ?? {}) as ErrLike
  const status = e.status
  const body = [e.message, typeof e.error === "string" ? e.error : JSON.stringify(e.error ?? "")].filter(Boolean).join(" ")
  const msg = body.slice(0, 500)
  const has = (re: RegExp) => re.test(body)
  const ra = retryAfter(e, body)
  const withRa = (cls: ErrorClass): Classified => ({ cls, message: msg, ...(ra !== undefined ? { retryAfterMs: ra } : {}) })

  if (e.code === "ETIMEDOUT" || e.code === "ECONNABORTED" || has(/timed? ?out|Request timed out/i) || status === 408 || status === 504) return withRa("timeout")
  if (has(/thought_signature/i)) return withRa("signature")
  if (status === 402 || e.code === "insufficient_quota" || has(/insufficient_quota|insufficient credits|negative balance|out of credits/i)) return withRa("out_of_funds")
  if (has(/free tier users do not have access|not available on your plan|does not have access to model/i)) return withRa("not_allowed")
  if (has(/no longer available|model_not_found|The model `[^`]+` does not exist|is not a valid model/i) || (status === 404 && has(/model/i))) return withRa("model_gone")
  if (has(/No endpoints found matching your data policy|no_providers_available|No allowed providers|matching your requirements/i)) return withRa("policy_blocked")
  // Groq rejects oversized requests with 413 or a 429 "Request too large … Requested N"
  if (status === 413 || has(/Request too large|context_length_exceeded|maximum context length|too many tokens/i)) return withRa("too_large")
  if (has(/per ?day|PerDay|free-models-per-day|daily limit|RPD/i) && (status === 429 || has(/quota|rate/i))) return withRa("daily_exhausted")
  if (status === 429 || has(/rate limit|RESOURCE_EXHAUSTED|Too Many Requests/i)) return withRa("rate_limited")
  if (status === 401 || status === 403) return withRa("auth_revoked")
  if (status === 503 || status === 529 || status === 502 || has(/high demand|overloaded|UNAVAILABLE|capacity/i)) return withRa("overloaded")
  if (status === 400 || status === 422) return withRa("bad_request")
  return withRa(status === undefined ? "timeout" : "server")
}

/** Which classes mean "this lane can't serve now, try another" (vs. failing the request). */
export const FAILOVER: ReadonlySet<ErrorClass> = new Set([
  "rate_limited", "daily_exhausted", "too_large", "overloaded", "timeout", "auth_revoked", "out_of_funds",
  "not_allowed", "policy_blocked", "model_gone", "server",
])
