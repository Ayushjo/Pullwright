import OpenAI from "openai"
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions"
import { costOf, getSpendLedger, priceFor, SpendLimitError, type LedgerEntry } from "./spend.js"
import logger from "../logger.js"

/**
 * Thin, metered OpenAI-compatible chat client.
 *
 * Messages use the OpenAI Chat Completions shape as the canonical format. Every call is
 * priced from real `usage` (incl. cached input tokens) and written to the spend ledger;
 * a pessimistic pre-call estimate is checked against the task + global caps first.
 */

export type Msg = ChatCompletionMessageParam
export type ToolDef = ChatCompletionFunctionTool
export type ToolCall = { id: string; name: string; rawArgs: string }

export type ModelSpec = {
  provider: "openai" | "openrouter"
  model: string
  /** gpt-5 family only */
  reasoningEffort?: "minimal" | "low" | "medium" | "high"
  apiKey?: string // BYOK; undefined → platform key
  baseURL?: string
}

export type LLMResult = {
  text: string
  toolCalls: ToolCall[]
  finishReason: string
  costUsd: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  durationMs: number
}

export type CallOptions = {
  taskId: string
  purpose: string
  messages: Msg[]
  tools?: ToolDef[]
  maxOutputTokens: number
  taskCapUsd?: number
  toolChoice?: "auto" | "required" | "none"
  onUsage?: (r: LLMResult & { model: string; purpose: string }) => void
}

const clients = new Map<string, OpenAI>()
function clientFor(spec: ModelSpec): OpenAI {
  const key = `${spec.provider}|${spec.baseURL ?? ""}|${spec.apiKey ?? "platform"}`
  let c = clients.get(key)
  if (!c) {
    const apiKey =
      spec.apiKey ?? (spec.provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY)
    if (!apiKey) throw new Error(`No API key configured for ${spec.provider}`)
    c = new OpenAI({
      apiKey,
      maxRetries: 0, // we retry ourselves so every attempt is metered
      timeout: 120_000,
      ...(spec.baseURL
        ? { baseURL: spec.baseURL }
        : spec.provider === "openrouter"
          ? { baseURL: "https://openrouter.ai/api/v1" }
          : {}),
    })
    clients.set(key, c)
  }
  return c
}

function estimateInputTokens(messages: Msg[], tools?: ToolDef[]): number {
  let chars = JSON.stringify(messages).length
  if (tools) chars += JSON.stringify(tools).length
  return Math.ceil(chars / 3.5)
}

function isReasoningModel(model: string) {
  return /^(gpt-5|o\d)/.test(model.replace(/^openai\//, ""))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function chat(spec: ModelSpec, opts: CallOptions): Promise<LLMResult> {
  const ledger = getSpendLedger()
  const keyOwner: LedgerEntry["keyOwner"] = spec.apiKey ? "byok" : "platform"
  const price = priceFor(spec.model)
  // Worst case assumes zero cache hits and a full-length completion.
  const worstCase =
    (estimateInputTokens(opts.messages, opts.tools) * price.input + opts.maxOutputTokens * price.output) / 1_000_000
  await ledger.assertCanSpend(opts.taskId, keyOwner, worstCase, opts.taskCapUsd)

  const client = clientFor(spec)
  const reasoning = isReasoningModel(spec.model)
  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: spec.model,
    messages: opts.messages,
    max_completion_tokens: opts.maxOutputTokens,
    prompt_cache_key: `pw-${opts.purpose}`,
    ...(opts.tools && opts.tools.length > 0
      ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto", parallel_tool_calls: true }
      : {}),
    ...(reasoning ? { reasoning_effort: spec.reasoningEffort ?? "low" } : { temperature: 0 }),
  }

  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now()
    try {
      const res = await client.chat.completions.create(body)
      const choice = res.choices[0]
      if (!choice) throw new Error("LLM returned no choices")
      const inputTokens = res.usage?.prompt_tokens ?? 0
      const cachedInputTokens = res.usage?.prompt_tokens_details?.cached_tokens ?? 0
      const outputTokens = res.usage?.completion_tokens ?? 0
      const costUsd = costOf(spec.model, { inputTokens, cachedInputTokens, outputTokens })
      await ledger.record({
        taskId: opts.taskId,
        keyOwner,
        provider: spec.provider,
        model: res.model ?? spec.model,
        purpose: opts.purpose,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costUsd,
      })
      const toolCalls = (choice.message.tool_calls ?? [])
        .filter((tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function")
        .map((tc) => ({ id: tc.id, name: tc.function.name, rawArgs: tc.function.arguments ?? "" }))
      const result: LLMResult = {
        text: choice.message.content ?? "",
        toolCalls,
        finishReason: choice.finish_reason ?? "stop",
        costUsd,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        durationMs: Date.now() - started,
      }
      opts.onUsage?.({ ...result, model: spec.model, purpose: opts.purpose })
      return result
    } catch (err) {
      if (err instanceof SpendLimitError) throw err
      lastErr = err
      const status = (err as { status?: number }).status
      const retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined
      // Insufficient quota is a 429 that will never succeed.
      const code = (err as { code?: string }).code
      if (!retryable || code === "insufficient_quota" || status === 400 || status === 401 || status === 404) {
        throw err
      }
      logger.warn(`LLM call failed (attempt ${attempt}/3): ${(err as Error).message}`)
      await sleep(1500 * attempt * attempt)
    }
  }
  throw lastErr
}
