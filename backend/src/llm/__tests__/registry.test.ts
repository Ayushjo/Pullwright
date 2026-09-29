import { describe, it, expect } from "vitest"
import { detectProvider, seedLimits } from "../registry.js"

describe("provider registry", () => {
  it("recognises pasted key formats", () => {
    expect(detectProvider("AQ.Ab8RN6Llcxso-PMYZdLEMIes7wb_a3bAtne6vuDyCdl")).toBe("gemini")
    expect(detectProvider("AIzaSyD4-abcdefghijklmnopqrstuvwxyz01234")).toBe("gemini")
    expect(detectProvider("gsk_abcdefghijklmnopqrstuvwxyz0123")).toBe("groq")
    expect(detectProvider("vck_abcdefghijklmnopqrstuvwxyz0123")).toBe("vercel")
    expect(detectProvider("sk-or-v1-abcdefghijklmnopqrstuvwxyz")).toBe("openrouter")
    expect(detectProvider("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe("anthropic")
    expect(detectProvider("sk-proj-abcdefghijklmnopqrstuvwxyz")).toBe("openai")
    expect(detectProvider("nvapi-abcdefghijklmnopqrstuvwxyz0123")).toBe("nvidia")
    expect(detectProvider("not a key")).toBeNull()
  })

  it("seed limits: Groq's 8K request cap, Gemini Flash vs Flash-Lite daily quotas", () => {
    expect(seedLimits("groq", "openai/gpt-oss-120b")).toMatchObject({ rpd: 1000, tpm: 8000, maxRequestTokens: 8000 })
    expect(seedLimits("gemini", "gemini-3.8-flash")).toMatchObject({ rpd: 20, tpm: 250_000 })
    expect(seedLimits("gemini", "gemini-3.5-flash-lite")).toMatchObject({ rpd: 500 })
    expect(seedLimits("openrouter", "qwen/qwen3.8-27b:free")).toMatchObject({ rpd: 50 })
    expect(seedLimits("openrouter", "openai/gpt-5-mini")).toEqual({})
  })
})
