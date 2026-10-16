import { describe, it, expect } from "vitest"
import { claudeCost, stripFence, toAnthropic, toolId } from "../anthropic.js"

describe("Claude adapter: canonical history → Messages API", () => {
  it("lifts the system prompt, merges tool results into one user turn, and keeps text after them", () => {
    const { system, messages } = toAnthropic(
      [
        { role: "system", content: "You are the agent." },
        { role: "user", content: "Fix the bug." },
        { role: "assistant", content: null, tool_calls: [{ id: "a1", type: "function", function: { name: "view", arguments: '{"path":"a.js"}' } }, { id: "a2", type: "function", function: { name: "view", arguments: '{"path":"b.js"}' } }] },
        { role: "tool", tool_call_id: "a1", content: "A" },
        { role: "tool", tool_call_id: "a2", content: "B" },
        { role: "user", content: "Keep going." },
      ] as never,
      "claude-haiku-5-5",
    )
    expect(system).toBe("You are the agent.")
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(messages[1]!.content).toEqual([
      { type: "tool_use", id: "a1", name: "view", input: { path: "a.js" } },
      { type: "tool_use", id: "a2", name: "view", input: { path: "b.js" } },
    ])
    expect(messages[2]!.content.map((b) => b.type)).toEqual(["tool_result", "tool_result", "text"])
  })

  it("replays this model's own turns verbatim (thinking included) and rebuilds other models' turns", () => {
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "view", input: { path: "x" } }]
    const turn = { role: "assistant", content: null, tool_calls: [{ id: "toolu_1", type: "function", function: { name: "view", arguments: '{"path":"x"}' }, extra_content: { anthropic: { model: "claude-sonnet-5-5", content: raw } } }] }
    const same = toAnthropic([{ role: "user", content: "go" }, turn, { role: "tool", tool_call_id: "toolu_1", content: "ok" }] as never, "claude-sonnet-5-5")
    expect(same.messages[1]!.content).toEqual(raw)
    // Another Claude model can't read these blocks: rebuild as plain tool_use (no thinking).
    const other = toAnthropic([{ role: "user", content: "go" }, turn, { role: "tool", tool_call_id: "toolu_1", content: "ok" }] as never, "claude-haiku-5-5")
    expect(other.messages[1]!.content).toEqual([{ type: "tool_use", id: "toolu_1", name: "view", input: { path: "x" } }])
  })

  it("maps foreign tool-call ids to valid ones, consistently on both sides", () => {
    const weird = "call:gemini/abc.def"
    const { messages } = toAnthropic(
      [{ role: "user", content: "go" }, { role: "assistant", content: null, tool_calls: [{ id: weird, type: "function", function: { name: "view", arguments: "{}" } }] }, { role: "tool", tool_call_id: weird, content: "r" }] as never,
      "claude-haiku-5-5",
    )
    const use = messages[1]!.content[0] as { id: string }
    const res = messages[2]!.content[0] as { tool_use_id: string }
    expect(use.id).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(res.tool_use_id).toBe(use.id)
    expect(toolId("toolu_ok-1")).toBe("toolu_ok-1")
  })

  it("turns data-URL images into base64 image blocks", () => {
    const { messages } = toAnthropic([{ role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] as never, "claude-haiku-5-5")
    expect(messages[0]!.content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } })
  })

  it("prices cache writes at 1.25× and reads at the cache price", () => {
    // Sonnet 5.5: $2 in, $0.2 cache read, $10 out per 1M.
    expect(claudeCost("claude-sonnet-5-5", { input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(2 + 2.5 + 0.2 + 10, 6)
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
})
