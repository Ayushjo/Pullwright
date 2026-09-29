import { describe, it, expect } from "vitest"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { attachmentsBlock, describeImages, parseVision } from "../intake/describe.js"
import type { Attachment } from "../intake/attachments.js"
import type { CallOptions, LLMResult } from "../llm.js"

const png = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../evals/fixtures/images/cart-nan.png")
const img = (n: number, extra: Partial<Attachment> = {}): Attachment => ({ n, where: "issue", kind: "image", url: "u", fetchUrl: "u", alt: "cart", context: "Total is wrong", file: png, mime: "image/png", ...extra })
const result = (text: string): LLMResult => ({ text, toolCalls: [], finishReason: "stop", costUsd: 0, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, durationMs: 1 }) as LLMResult

describe("describeImages", () => {
  it("sends the image as a data URL with the issue context and stores a redacted transcript", async () => {
    const seen: CallOptions[] = []
    const chat = async (o: CallOptions) => {
      seen.push(o)
      return result(JSON.stringify({ kind: "screenshot", visibleText: "Total $NaN · key sk-proj-abcdefghijklmnopqrstuvwxyz123456", elements: "cart table", whatLooksWrong: "total is NaN", relationToIssue: "shows the bug", confidence: "high" }))
    }
    const [a] = await describeImages([img(1)], { title: "Cart total broken", body: "see image" }, chat, "t1")
    const parts = (seen[0]!.messages[1] as { content: { type: string; image_url?: { url: string } }[] }).content
    expect(parts[1]!.image_url!.url.startsWith("data:image/png;base64,")).toBe(true)
    expect(seen[0]!.jsonMode).toBe(true)
    expect(a!.vision!.kind).toBe("screenshot")
    expect(a!.description).toContain("looks wrong: total is NaN")
    expect(a!.description).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456")
  })

  it("a failed call leaves the image without a transcript and says why; non-images pass through", async () => {
    const chat = async () => {
      throw new Error("No model lane available")
    }
    const out = await describeImages([img(1), { ...img(2), kind: "video", file: undefined, skipped: "video (not analysed)" }], { title: "t", body: "" }, chat, "t1")
    expect(out[0]!.skipped).toMatch(/could not be read/)
    expect(out[1]!.skipped).toBe("video (not analysed)")
  })
})

describe("parseVision / attachmentsBlock", () => {
  it("tolerates prose around the JSON and unknown kinds", () => {
    expect(parseVision('Sure! {"kind":"weird","visibleText":"x","confidence":"sure"}')).toMatchObject({ kind: "other", visibleText: "x", confidence: "low" })
    expect(parseVision("no json")).toBeNull()
  })

  it("renders transcripts in place and lists what was skipped", () => {
    const block = attachmentsBlock([
      { ...img(1), description: "kind: screenshot (confidence high)\nvisible text: Total $NaN" },
      { ...img(2), kind: "video", skipped: "video (not analysed)" },
    ])
    expect(block).toContain('[attachment 1 · image · issue · "cart"] (next to: "Total is wrong")')
    expect(block).toContain("visible text: Total $NaN")
    expect(block).toContain("[attachment 2 · video · issue")
    expect(block).toContain("not available: video (not analysed)")
  })
})
