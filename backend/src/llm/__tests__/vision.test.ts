import { describe, it, expect } from "vitest"
import { supportsVision } from "../registry.js"

describe("supportsVision: only what probe-vision measured", () => {
  it("measured readers", () => {
    expect(supportsVision("vercel", "openai/gpt-5-mini")).toBe(true)
    expect(supportsVision("openai", "gpt-5.4-nano")).toBe(true)
    expect(supportsVision("gemini", "gemini-3.5-flash-lite")).toBe(true)
    expect(supportsVision("groq", "qwen/qwen3.8-27b")).toBe(true)
  })
  it("excluded or unmeasured", () => {
    expect(supportsVision("groq", "openai/gpt-oss-120b")).toBe(false) // text only
    expect(supportsVision("vercel", "openai/gpt-4o-mini")).toBe(false) // 25.5K tokens per image
    expect(supportsVision("gemini", "gemma-4-26b-a4b-it")).toBe(false) // leaks thoughts
    expect(supportsVision("openrouter", "deepseek/deepseek-v4.1-flash")).toBe(false) // not measured
  })
})
