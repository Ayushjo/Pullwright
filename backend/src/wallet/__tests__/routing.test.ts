import { describe, it, expect } from "vitest"
import { walletCapability, walletLanes } from "../routing.js"

const k = (provider: "gemini" | "groq" | "vercel" | "openrouter" | "openai", tier = "free", meta: Record<string, unknown> | null = null) => ({ provider, key: `key-${provider}`, tier, meta })
const names = (ls: { provider: string; model: string }[]) => ls.map((l) => `${l.provider}:${l.model}`)

describe("walletLanes", () => {
  it("totally free (Gemini + Groq): plan on the Flash pool, execute on Flash-Lite, review on Groq first", () => {
    const keys = [k("gemini"), k("groq")]
    expect(names(walletLanes("u", keys, "plan"))[0]).toBe("gemini:gemini-3.6-flash")
    expect(names(walletLanes("u", keys, "run")).slice(0, 2)).toEqual(["gemini:gemini-3.5-flash-lite", "gemini:gemini-3.1-flash-lite"])
    expect(names(walletLanes("u", keys, "judge"))[0]).toBe("groq:openai/gpt-oss-120b")
    expect(names(walletLanes("u", keys, "vision"))[0]).toBe("groq:qwen/qwen3.8-27b")
    expect(walletLanes("u", keys, "judge").some((l) => l.model.includes("flash-lite"))).toBe(false) // Flash-Lite never reviews
  })

  it("the Vercel free credit plans and reviews first; a spent credit is skipped", () => {
    const keys = [k("gemini"), k("vercel", "free_credit", { balanceUsd: 3.2 })]
    expect(names(walletLanes("u", keys, "plan"))[0]).toBe("vercel:openai/gpt-5-mini")
    expect(walletLanes("u", keys, "plan")[0]!.spendClass).toBe("free_credit")
    const spent = [k("gemini"), k("vercel", "free_credit", { balanceUsd: 0.01 })]
    expect(names(walletLanes("u", spent, "plan"))[0]).toBe("gemini:gemini-3.6-flash")
  })

  it("paid keys come last and are marked as the user's own spend", () => {
    const lanes = walletLanes("u", [k("openai", "paid"), k("gemini")], "plan")
    expect(lanes.at(-1)).toMatchObject({ provider: "openai", model: "gpt-5-mini", spendClass: "byok", ownerUserId: "u" })
  })

  it("private repo without consent: no lanes that may train on prompts", () => {
    const keys = [k("gemini"), k("groq"), k("openrouter", "free")]
    expect(walletLanes("u", keys, "plan", { privateRepo: true })).toEqual([])
    expect(names(walletLanes("u", keys, "judge", { privateRepo: true }))).toEqual(["groq:openai/gpt-oss-120b"])
    expect(walletLanes("u", keys, "plan", { privateRepo: true, allowTraining: true }).length).toBeGreaterThan(0)
  })

  it("capability: Groq alone can't run tasks, and says what to add", () => {
    expect(walletCapability([k("groq")])).toMatchObject({ canRun: false, canReview: true })
    expect(walletCapability([k("groq")]).missing).toMatch(/Gemini/)
    expect(walletCapability([k("gemini")])).toMatchObject({ canRun: true, allFree: true })
    expect(walletCapability([k("gemini"), k("openai", "paid")]).allFree).toBe(false)
  })

  it("capability for a private repo: training-only keys need consent; a non-training planner doesn't", () => {
    expect(walletCapability([k("gemini"), k("groq")], { privateRepo: true }).canRun).toBe(false)
    expect(walletCapability([k("gemini"), k("groq")], { privateRepo: true, allowTraining: true }).canRun).toBe(true)
    expect(walletCapability([k("gemini"), k("vercel", "free_credit", { balanceUsd: 4 })], { privateRepo: true }).canRun).toBe(true)
    expect(walletCapability([k("gemini")]).canRun).toBe(true) // public repos are unaffected
  })
})
