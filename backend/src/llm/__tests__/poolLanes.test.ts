import { describe, it, expect, beforeEach } from "vitest"
import { parseLanes } from "../lanes.js"

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test"
  delete process.env.ANTHROPIC_POOL_MONTHLY_USD
})

describe("platform lanes on a budgeted key", () => {
  it("are pool lanes when the provider has a pool budget, platform lanes otherwise", () => {
    expect(parseLanes("anthropic:claude-haiku-5-5")[0]!.spendClass).toBe("platform")
    process.env.ANTHROPIC_POOL_MONTHLY_USD = "80"
    expect(parseLanes("anthropic:claude-haiku-5-5")[0]).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", spendClass: "pool" })
  })
})
