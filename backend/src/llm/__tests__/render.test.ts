import { describe, it, expect } from "vitest"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { renderMessages, SKIP_SIGNATURE } from "../render.js"

const call = (id: string, origin?: string, signature?: string) => ({
  id,
  type: "function",
  function: { name: "view", arguments: '{"path":"a.ts"}' },
  ...(signature ? { extra_content: { google: { thought_signature: signature } } } : {}),
  ...(origin ? { _origin: origin } : {}),
})
const history = (...calls: object[]) =>
  [
    { role: "user", content: "go" },
    { role: "assistant", content: null, tool_calls: calls },
    ...calls.map((c) => ({ role: "tool", tool_call_id: (c as { id: string }).id, content: "ok" })),
  ] as unknown as ChatCompletionMessageParam[]

const toolCalls = (msgs: ChatCompletionMessageParam[]) => (msgs[1] as unknown as { tool_calls: Record<string, unknown>[] }).tool_calls

describe("renderMessages", () => {
  it("sends Gemini its own signatures back unchanged", () => {
    const out = toolCalls(renderMessages(history(call("c1", "gemini/gemini-3.8-flash", "SIG1")), { provider: "gemini", model: "gemini-3.8-flash" }))
    expect(out[0]).toEqual({ id: "c1", type: "function", function: { name: "view", arguments: '{"path":"a.ts"}' }, extra_content: { google: { thought_signature: "SIG1" } } })
  })

  it("uses the placeholder for history written by another model (lane switch into Gemini)", () => {
    const out = toolCalls(renderMessages(history(call("c1", "openai/gpt-5-mini"), call("c2", "gemini/gemini-3.6-flash", "OTHER")), { provider: "gemini", model: "gemini-3.8-flash" }))
    expect(out.map((c) => (c.extra_content as { google: { thought_signature: string } }).google.thought_signature)).toEqual([SKIP_SIGNATURE, SKIP_SIGNATURE])
  })

  it("strips Gemini fields and the private origin for other providers", () => {
    const out = toolCalls(renderMessages(history(call("c1", "gemini/gemini-3.8-flash", "SIG1")), { provider: "openai", model: "gpt-5-mini" }))
    expect(out[0]).toEqual({ id: "c1", type: "function", function: { name: "view", arguments: '{"path":"a.ts"}' } })
  })

  it("leaves messages without tool calls untouched", () => {
    const msgs = [{ role: "system", content: "s" }, { role: "user", content: "u" }] as ChatCompletionMessageParam[]
    expect(renderMessages(msgs, { provider: "gemini", model: "x" })).toEqual(msgs)
  })
})
