import Anthropic from "@anthropic-ai/sdk"
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { createHash } from "crypto"
import type { ToolDef } from "../agent/llm.js"

/**
 * Native Anthropic Messages API adapter behind the same chat() contract as the OpenAI-compatible
 * providers: canonical history (OpenAI Chat Completions shape) in, text + tool calls + usage out.
 *
 * Why native and not Anthropic's OpenAI-compatible endpoint: prompt caching (most of our input
 * tokens repeat across a task's calls) and thinking-block replay need the Messages API.
 *
 * Rules this follows (Claude 5.5 / Fable 5.1 family):
 *  - thinking is adaptive (it can't be disabled on Opus 5.5); depth is set by output_config.effort;
 *  - every Claude assistant turn is replayed byte-for-byte from its raw content blocks (stored on the
 *    turn's first tool call as `extra_content.anthropic.content`), so thinking stays valid ("preserved
 *    thinking"); turns written by other models are rebuilt as plain text + tool_use;
 *  - `block_binding.prefix_mismatch_behavior: "drop_block"` (beta thinking-binding-controls) degrades
 *    to "re-plan without the old reasoning" instead of a 400 if a history ever changes;
 *  - forced tool choice is rejected on these models, so tool_choice is always auto (the agent loop
 *    already nudges a turn that calls no tool);
 *  - JSON mode becomes an instruction plus fence stripping (no schema is available here);
 *  - server-side refusal fallback ("default") is on, so a classifier decline is retried on another model;
 *  - automatic prompt caching on the last cacheable block.
 */

export const ANTHROPIC_BETAS = ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"]

/** USD per 1M tokens. Cache writes (5-minute TTL) are 1.25× input. */
export const CLAUDE_PRICES: Record<string, { input: number; cacheRead: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, cacheRead: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2.0, cacheRead: 0.2, output: 10.0 },
  "claude-opus-5-5": { input: 4.0, cacheRead: 0.2, output: 20.0 },
  "claude-fable-5-1": { input: 10.0, cacheRead: 0.25, output: 50.0 },
  "claude-opus-5": { input: 5.0, cacheRead: 0.5, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, cacheRead: 0.2, output: 10.0 },
}

export function claudeCost(model: string, u: { input_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; output_tokens: number }): number {
  const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES[Object.keys(CLAUDE_PRICES).find((k) => model.startsWith(k)) ?? ""] ?? { input: 10, cacheRead: 1, output: 50 }
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  return (u.input_tokens * p.input + write * p.input * 1.25 + read * p.cacheRead + u.output_tokens * p.output) / 1_000_000
}

type Block = Anthropic.Beta.BetaContentBlockParam
type AnthMessage = { role: "user" | "assistant"; content: Block[] }
type ToolCallish = { id: string; function: { name: string; arguments: string }; extra_content?: { anthropic?: { content?: Block[]; model?: string } }; _origin?: string }

/** tool_use ids must match ^[a-zA-Z0-9_-]+$; other providers' ids are mapped deterministically. */
export function toolId(id: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : `t_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = raw.trim() ? JSON.parse(raw) : {}
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return { _raw: raw } // a malformed call from another model: keep it visible rather than drop the turn
  }
}

function userParts(content: string | ChatCompletionContentPart[]): Block[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : []
  const out: Block[] = []
  for (const p of content) {
    if (p.type === "text") {
      if (p.text) out.push({ type: "text", text: p.text })
    } else if (p.type === "image_url") {
      const m = p.image_url.url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/)
      if (m) out.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2]! } })
      else out.push({ type: "image", source: { type: "url", url: p.image_url.url } })
    }
  }
  return out
}

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : "")).join("") : ""

/** Canonical history → { system, messages } for the Messages API (consecutive same-role turns merged). */
export function toAnthropic(messages: ChatCompletionMessageParam[], model: string): { system: string; messages: AnthMessage[] } {
  const system: string[] = []
  const out: AnthMessage[] = []
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: [...blocks] })
  }
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") {
      // A leading system prompt is top-level; one that arrives mid-conversation becomes a user note.
      if (!out.length) system.push(textOf(m.content))
      else push("user", [{ type: "text", text: `[system] ${textOf(m.content)}` }])
    } else if (m.role === "user") {
      push("user", userParts(m.content as string | ChatCompletionContentPart[]))
    } else if (m.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: toolId(m.tool_call_id), content: textOf(m.content) || "(empty)" }])
    } else if (m.role === "assistant") {
      const calls = ((m as { tool_calls?: ToolCallish[] }).tool_calls ?? []) as ToolCallish[]
      const raw = calls[0]?.extra_content?.anthropic
      // Our own turn on this model: replay it exactly as the API returned it (keeps thinking valid).
      if (raw?.content && raw.model === model) {
        push("assistant", raw.content)
        continue
      }
      const blocks: Block[] = []
      const text = textOf(m.content)
      if (text.trim()) blocks.push({ type: "text", text })
      for (const tc of calls) blocks.push({ type: "tool_use", id: toolId(tc.id), name: tc.function.name, input: parseArgs(tc.function.arguments) })
      push("assistant", blocks.length ? blocks : [{ type: "text", text: "(no output)" }])
    }
  }
  return { system: system.filter(Boolean).join("\n\n"), messages: out }
}

export function toAnthropicTools(tools: ToolDef[] | undefined): Anthropic.Beta.BetaTool[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: (t.function.parameters ?? { type: "object", properties: {} }) as Anthropic.Beta.BetaTool.InputSchema,
  }))
}

/** Text with a leading/trailing ``` fence removed (JSON mode has no schema to constrain output). */
export function stripFence(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1]! : s
}

export type ClaudeResult = {
  text: string
  toolCalls: { id: string; name: string; rawArgs: string; extra?: unknown }[]
  finishReason: string
  model: string
  usage: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number }
  costUsd: number
  /** Blocks the API dropped or flagged (input_transformations), for the eval logs. */
  transformations: unknown[]
}

const clients = new Map<string, Anthropic>()
function clientFor(apiKey: string): Anthropic {
  const k = createHash("sha256").update(apiKey).digest("hex").slice(0, 16)
  let c = clients.get(k)
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 0 })
    clients.set(k, c)
  }
  return c
}

export type ClaudeCall = {
  model: string
  apiKey: string
  messages: ChatCompletionMessageParam[]
  tools?: ToolDef[]
  maxOutputTokens: number
  jsonMode?: boolean
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  timeoutMs?: number
}

export async function claudeChat(call: ClaudeCall): Promise<ClaudeResult> {
  const { system, messages } = toAnthropic(call.messages, call.model)
  const tools = toAnthropicTools(call.tools)
  const sys = call.jsonMode ? `${system}\n\nRespond with only a single JSON object — no prose and no code fences.`.trim() : system
  // Thinking counts toward max_tokens: leave room so a long think doesn't truncate the tool call.
  const maxTokens = Math.min(64_000, Math.max(16_000, call.maxOutputTokens * 2))
  const body = {
    model: call.model,
    max_tokens: maxTokens,
    ...(sys ? { system: sys } : {}),
    messages,
    ...(tools ? { tools, tool_choice: { type: "auto" as const } } : {}),
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: call.effort ?? "medium" },
    cache_control: { type: "ephemeral" },
    fallbacks: "default",
    betas: ANTHROPIC_BETAS,
  }
  // Fields newer than the installed SDK's types (block_binding, fallbacks: "default") go through a cast.
  const stream = clientFor(call.apiKey).beta.messages.stream(body as unknown as Anthropic.Beta.MessageCreateParamsStreaming, { timeout: Math.max(call.timeoutMs ?? 0, 300_000) })
  const msg = await stream.finalMessage()
  const u = msg.usage
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  let text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("")
  if (call.jsonMode) text = stripFence(text)
  const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
  // The whole response, verbatim, rides on the first tool call so the next request can replay it.
  const raw = { anthropic: { model: msg.model, content: msg.content as unknown as Block[] } }
  const toolCalls = uses.map((b, i) => ({ id: b.id, name: b.name, rawArgs: JSON.stringify(b.input ?? {}), ...(i === 0 ? { extra: raw } : {}) }))
  const finishReason = msg.stop_reason === "tool_use" ? "tool_calls" : msg.stop_reason === "max_tokens" ? "length" : msg.stop_reason === "refusal" ? "refusal" : "stop"
  return {
    text,
    toolCalls,
    finishReason,
    model: msg.model,
    usage: { inputTokens: u.input_tokens + read + write, cachedInputTokens: read, cacheWriteTokens: write, outputTokens: u.output_tokens },
    costUsd: claudeCost(msg.model, u),
    transformations: ((msg as unknown as { input_transformations?: unknown[] }).input_transformations ?? []),
  }
}
