import { describe, it, expect } from "vitest"
import { classifyError, parseDuration } from "../errors.js"

/** Shaped like the OpenAI SDK's APIError: status, message, parsed error body, headers. */
const apiErr = (status: number | undefined, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  message: `${status ?? ""} ${typeof body === "string" ? body : JSON.stringify(body)}`,
  error: body,
  headers,
})

describe("classifyError — real bodies captured on the owner's keys (2026-09-27/29)", () => {
  it("Groq: a request above the 8K free-tier cap is too_large, not a rate limit", () => {
    const body = {
      message:
        "Request too large for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9585, please reduce your message size and try again.",
      type: "tokens",
      code: "rate_limit_exceeded",
    }
    expect(classifyError(apiErr(413, body)).cls).toBe("too_large")
    expect(classifyError(apiErr(429, body)).cls).toBe("too_large")
  })

  it("Groq: a normal TPM rate limit carries its retry delay", () => {
    const c = classifyError(apiErr(429, { message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 500. Please try again in 1m26.4s." }))
    expect(c.cls).toBe("rate_limited")
    expect(c.retryAfterMs).toBe(86_400)
  })

  it("Vercel free tier: the per-minute limit's retry hint is only in the message text", () => {
    const c = classifyError(apiErr(429, { message: "Rate limit exceeded for openai/gpt-5-mini for provider openai: this team's limit of 5 requests per minute (across all regions) was reached. Retry after 60s." }))
    expect(c.cls).toBe("rate_limited")
    expect(c.retryAfterMs).toBe(60_000)
  })

  it("Gemini: missing thought signature, high demand, model no longer available", () => {
    expect(classifyError(apiErr(400, { message: "Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly" })).cls).toBe("signature")
    expect(classifyError(apiErr(503, { message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.", status: "UNAVAILABLE" })).cls).toBe("overloaded")
    expect(classifyError(apiErr(404, { message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash" })).cls).toBe("model_gone")
  })

  it("Vercel: the free tier can't use this model", () => {
    const body = { message: "Free tier users do not have access to this model. Upgrade to paid credits at https://vercel.com/…", type: "no_providers_available" }
    expect(classifyError(apiErr(403, body)).cls).toBe("not_allowed")
  })
})

describe("classifyError — documented shapes", () => {
  it("Gemini daily quota vs per-minute quota", () => {
    const quota = (quotaId: string) => ({
      code: 429,
      message: "You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
      ],
    })
    expect(classifyError(apiErr(429, quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).cls).toBe("daily_exhausted")
    const rpm = classifyError(apiErr(429, quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")))
    expect(rpm.cls).toBe("rate_limited")
    expect(rpm.retryAfterMs).toBe(34_000)
  })

  it("OpenRouter free-model daily cap and empty balance", () => {
    expect(classifyError(apiErr(429, { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day" })).cls).toBe("daily_exhausted")
    expect(classifyError(apiErr(402, { message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits" })).cls).toBe("out_of_funds")
    expect(classifyError(apiErr(503, { message: "No endpoints found matching your data policy (Free model publication)." })).cls).toBe("policy_blocked")
  })

  it("OpenAI insufficient_quota is out of funds, not a retryable 429; 401 is a revoked key", () => {
    expect(classifyError({ status: 429, code: "insufficient_quota", message: "You exceeded your current quota" }).cls).toBe("out_of_funds")
    expect(classifyError(apiErr(401, { message: "Incorrect API key provided" })).cls).toBe("auth_revoked")
  })

  it("timeouts and Retry-After headers", () => {
    expect(classifyError({ message: "Request timed out." }).cls).toBe("timeout")
    expect(classifyError(apiErr(429, { message: "slow down" }, { "retry-after": "12" })).retryAfterMs).toBe(12_000)
  })

  it("parses durations", () => {
    expect(parseDuration("1m26.4s")).toBe(86_400)
    expect(parseDuration("697ms")).toBe(697)
    expect(parseDuration("34s")).toBe(34_000)
  })
})
