import { describe, it, expect, vi, beforeEach } from "vitest"

let githubCreatedAt: Date | null = new Date("2020-01-01")
let used = 0
let spent = { dayUsd: 0, monthUsd: 0 }
vi.mock("../../db/prisma.js", () => ({
  getPrisma: () => ({
    user: { findUnique: async () => ({ githubCreatedAt }) },
    task: { count: async () => used },
  }),
}))
vi.mock("../../agent/spend.js", async (orig) => ({
  ...(await orig<typeof import("../../agent/spend.js")>()),
  getSpendLedger: () => ({ poolSpent: async () => spent }),
}))

const { freeAllowance, canUseFree } = await import("../freeAllowance.js")
const now = new Date("2026-10-17T12:00:00Z")

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test"
  process.env.ANTHROPIC_POOL_MONTHLY_USD = "80"
  process.env.ANTHROPIC_POOL_DAILY_USD = "2.7"
  process.env.FREE_CLAUDE_TASKS_PER_MONTH = "10"
  delete process.env.FREE_CLAUDE_ENABLED
  githubCreatedAt = new Date("2020-01-01")
  used = 0
  spent = { dayUsd: 0, monthUsd: 0 }
})

describe("free monthly Claude allowance", () => {
  it("gives an eligible user N tasks a month on Haiku, renewing on the 1st (UTC)", async () => {
    used = 3
    const f = await freeAllowance("u", now)
    expect(f).toMatchObject({ enabled: true, limit: 10, used: 3, left: 7, poolOpen: true, model: "claude-haiku-5-5", renewsAt: "2026-11-01T00:00:00.000Z" })
    expect(canUseFree(f)).toBe(true)
  })

  it("stops at the limit", async () => {
    used = 10
    const f = await freeAllowance("u", now)
    expect(f.left).toBe(0)
    expect(canUseFree(f)).toBe(false)
  })

  it("refuses GitHub accounts younger than 30 days, or of unknown age", async () => {
    githubCreatedAt = new Date("2026-10-01")
    expect(canUseFree(await freeAllowance("u", now))).toBe(false)
    expect((await freeAllowance("u", now)).ineligible).toMatch(/30 days/)
    githubCreatedAt = null
    expect((await freeAllowance("u", now)).ineligible).toMatch(/Sign out/)
  })

  it("closes for the day when the shared pool can't cover one more capped task, and says when it reopens", async () => {
    spent = { dayUsd: 2.6, monthUsd: 10 } // 2.6 + 0.15 > 2.7
    const f = await freeAllowance("u", now)
    expect(f.poolOpen).toBe(false)
    expect(new Date(f.poolOpensAt!).getUTCHours()).toBe(0)
    expect(canUseFree(f)).toBe(false)
    spent = { dayUsd: 0, monthUsd: 79.9 } // the month is spent: reopens on the 1st
    expect((await freeAllowance("u", now)).poolOpensAt).toBe("2026-11-01T00:00:00.000Z")
  })

  it("is off without a configured pool or key, or with the kill switch", async () => {
    process.env.FREE_CLAUDE_ENABLED = "0"
    expect((await freeAllowance("u", now)).enabled).toBe(false)
    delete process.env.FREE_CLAUDE_ENABLED
    delete process.env.ANTHROPIC_POOL_MONTHLY_USD
    expect((await freeAllowance("u", now)).enabled).toBe(false)
  })
})
