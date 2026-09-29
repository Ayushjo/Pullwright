import { describe, it, expect, vi } from "vitest"

vi.mock("../../repositories/llmCallRepository.js", () => ({ queueLlmCall: () => {}, sumPlatformSpend: async () => 0 }))
const { refreshCatalog, routePrice, _setRoute } = await import("../catalog.js")
const { priceFor } = await import("../../agent/spend.js")

describe("price catalog", () => {
  it("loads per-route prices from the gateways' model lists", async () => {
    const fake = (async (url: string) => ({
      json: async () =>
        url.includes("openrouter")
          ? { data: [{ id: "deepseek/deepseek-v4.1-flash", pricing: { prompt: "0.000000035", completion: "0.00000029", input_cache_read: "0.000000001" } }] }
          : { data: [{ id: "deepseek/deepseek-v4.1-flash", pricing: { input: "0.0000003", output: "0.0000012" } }] },
    })) as unknown as typeof fetch
    process.env.AI_GATEWAY_API_KEY = "vck_test"
    await refreshCatalog(fake)
    expect(routePrice("openrouter", "deepseek/deepseek-v4.1-flash")).toEqual({ input: 0.035, output: 0.29, cachedInput: 0.001 })
    expect(routePrice("vercel", "deepseek/deepseek-v4.1-flash")?.input).toBeCloseTo(0.3)
  })

  it("priceFor prefers the route's live price, then the static table", () => {
    _setRoute("vercel", "openai/gpt-5-mini", { input: 0.2, cachedInput: 0.02, output: 1.5 })
    expect(priceFor("openai/gpt-5-mini", "vercel").input).toBe(0.2)
    expect(priceFor("openai/gpt-5-mini", "openai").input).toBe(0.25) // no route entry → table
    _setRoute("vercel", "openai/gpt-5-mini", undefined)
  })
})
