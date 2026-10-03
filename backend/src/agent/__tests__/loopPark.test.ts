import { describe, it, expect } from "vitest"
import { AgentLoop } from "../loop.js"
import { NoLaneAvailable } from "../../llm/gateway.js"
import type { Tool } from "../tools/index.js"
import type { CallOptions, LLMResult } from "../llm.js"

const view: Tool = {
  def: { type: "function", function: { name: "view", description: "view", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  handler: async () => ({ ok: true, output: "export const x = 1" }),
}
const result = (calls: { id: string; name: string; rawArgs: string }[]): LLMResult => ({ text: "", toolCalls: calls, finishReason: "tool_calls", costUsd: 0, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, durationMs: 1 }) as LLMResult
const limits = { maxSteps: 10, maxWallMs: 60_000, maxFormatErrors: 3, maxOutputTokens: 1000 }

describe("AgentLoop parks when no model lane is available", () => {
  it("returns parked with the retry time, and the conversation can be resumed as is", async () => {
    let n = 0
    const until = Date.now() + 3_600_000
    const chat = async (_o: CallOptions) => {
      if (n++ === 0) return result([{ id: "c1", name: "view", rawArgs: '{"path":"a.ts"}' }])
      throw new NoLaneAvailable(until, [])
    }
    const loop = new AgentLoop("t", "run", chat, "sys", "do it", [view], limits, { emit: () => {} })
    const out = await loop.run()
    expect(out).toMatchObject({ status: "parked", retryAt: until })
    expect(loop.steps).toBe(1)
    // Last message is the tool result: a resumed loop can append a note and call the model again.
    expect(loop.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" })

    let seen: CallOptions | null = null
    const resumed = new AgentLoop("t", "run", async (o) => {
      seen = o
      throw new NoLaneAvailable(null, [])
    }, "sys", "ignored", [view], limits, { emit: () => {} }, loop.messages)
    resumed.addUserMessage("resumed")
    const again = await resumed.run()
    expect(again).toMatchObject({ status: "parked", retryAt: null })
    expect(seen!.messages.at(-1)).toMatchObject({ role: "user", content: "resumed" })
    expect(seen!.messages.length).toBe(loop.messages.length)
  })
})
