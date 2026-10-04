import { describe, it, expect } from "vitest"
import { buildRequestBody } from "../llm.js"

const tools = [{ type: "function" as const, function: { name: "view", parameters: { type: "object", properties: {} } } }]
const opts = { taskId: "t1", purpose: "run", messages: [{ role: "user" as const, content: "hi" }], tools, toolChoice: "required" as const, maxOutputTokens: 1000, jsonMode: false }
const body = (provider: Parameters<typeof buildRequestBody>[0]["provider"], model: string, extra = {}) =>
  buildRequestBody({ provider, model, reasoningEffort: "low", ...extra }, opts) as unknown as Record<string, unknown>

describe("buildRequestBody: only what each provider accepts", () => {
  it("OpenAI: max_completion_tokens, per-task cache key, reasoning effort, parallel tool calls", () => {
    const b = body("openai", "gpt-5-mini")
    expect(b.max_completion_tokens).toBe(1000)
    expect(b.prompt_cache_key).toBe("pw-run-t1")
    expect(b.reasoning_effort).toBe("low")
    expect(b.parallel_tool_calls).toBe(true)
    expect(b.temperature).toBeUndefined()
  })

  it("Groq: max_tokens, no cache key, no reasoning effort", () => {
    const b = body("groq", "openai/gpt-oss-120b")
    expect(b.max_tokens).toBe(1000)
    expect(b.max_completion_tokens).toBeUndefined()
    expect(b.prompt_cache_key).toBeUndefined()
    expect(b.reasoning_effort).toBeUndefined()
  })

  it("Gemini thinking models get reasoning effort; Gemma on the same API does not (it rejects it)", () => {
    expect(body("gemini", "gemini-3.8-flash").reasoning_effort).toBe("low")
    expect(body("gemini", "gemma-4-26b-a4b-it").reasoning_effort).toBeUndefined()
  })

  it("OpenRouter: sticky session per task and require_parameters", () => {
    const b = body("openrouter", "deepseek/deepseek-v4.1-flash")
    expect(b.session_id).toBe("pw-t1")
    expect(b.provider).toEqual({ require_parameters: true })
    expect(b.models).toBeUndefined() // no gateway-side model fallback
    // With require_parameters, parallel_tool_calls filtered out every :free endpoint (404).
    expect(b.parallel_tool_calls).toBeUndefined()
  })

  it("temperature 0 only for OpenAI non-reasoning models", () => {
    expect(body("openai", "gpt-4o-mini").temperature).toBe(0)
    expect(body("vercel", "openai/gpt-4o-mini").temperature).toBeUndefined()
  })
})
