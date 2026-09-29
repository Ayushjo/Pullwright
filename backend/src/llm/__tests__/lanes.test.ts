import { describe, it, expect, vi } from "vitest"

vi.mock("../../config/redis.js", () => ({ createRedisClient: () => ({}) }))
const { parseLanes, laneFromSpec } = await import("../lanes.js")

describe("lanes", () => {
  it("parses a lane list, assigns who pays, and drops providers without a configured key", () => {
    process.env.AI_GATEWAY_API_KEY = "vck_x"
    process.env.GEMINI_API_KEY = "AQ.x"
    delete process.env.MISTRAL_API_KEY
    const lanes = parseLanes("vercel:openai/gpt-5-mini, gemini:gemini-3.5-flash-lite, mistral:devstral, nonsense", "low")
    expect(lanes.map((l) => [l.provider, l.model, l.spendClass])).toEqual([
      ["vercel", "openai/gpt-5-mini", "free_credit"],
      ["gemini", "gemini-3.5-flash-lite", "free"],
    ])
    expect(lanes[0]!.reasoningEffort).toBe("low")
  })

  it("a user's key becomes a byok lane owned by that user", () => {
    const l = laneFromSpec({ provider: "openrouter", model: "openai/gpt-5-mini", apiKey: "sk-or-v1-x" }, "u1")
    expect(l).toMatchObject({ credentialId: "user:u1:openrouter", ownerUserId: "u1", spendClass: "byok", apiKey: "sk-or-v1-x" })
    expect(laneFromSpec({ provider: "openai", model: "gpt-5-mini" })).toMatchObject({ credentialId: "platform:openai", spendClass: "platform" })
  })
})
