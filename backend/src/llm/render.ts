import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

/**
 * Canonical history → what a specific provider/model accepts.
 *
 * Gemini 3 rejects a multi-turn tool conversation (HTTP 400 "Function call is missing a
 * thought_signature") unless each tool call it produced is sent back with its
 * extra_content.google.thought_signature. For history written by another model (or a signature that
 * was lost) Google accepts the placeholder below — both verified on the owner's key, 2026-09-27.
 * Other providers must not receive the Gemini field.
 *
 * Tool calls carry a private `_origin` ("provider/model") so we know which model wrote them; it is
 * never sent.
 */

export const SKIP_SIGNATURE = "skip_thought_signature_validator"

export type Target = { provider: string; model: string }
type ToolCallish = { id: string; type?: string; function: { name: string; arguments: string }; extra_content?: { google?: { thought_signature?: string } } & Record<string, unknown>; _origin?: string }

export const originOf = (t: Target) => `${t.provider}/${t.model}`
const isGemini = (t: Target) => t.provider === "gemini"

export function renderMessages(messages: ChatCompletionMessageParam[], target: Target): ChatCompletionMessageParam[] {
  const origin = originOf(target)
  return messages.map((m) => {
    if (m.role !== "assistant" || !("tool_calls" in m) || !m.tool_calls?.length) return m
    const tool_calls = (m.tool_calls as unknown as ToolCallish[]).map((tc) => {
      const { _origin, extra_content, ...rest } = tc
      if (!isGemini(target)) return rest
      const own = _origin === origin ? extra_content?.google?.thought_signature : undefined
      return { ...rest, extra_content: { ...(extra_content ?? {}), google: { thought_signature: own ?? SKIP_SIGNATURE } } }
    })
    return { ...m, tool_calls } as unknown as ChatCompletionMessageParam
  })
}

/** Tag tool calls from a response with their origin and keep the provider's sidecar fields. */
export function tagToolCalls<T extends { extra_content?: unknown }>(calls: T[], target: Target): (T & { _origin: string })[] {
  return calls.map((c) => ({ ...c, _origin: originOf(target) }))
}
