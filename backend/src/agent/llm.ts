import OpenAI from "openai"
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions"
import { costOf, getSpendLedger, priceFor, SpendLimitError, type Hold, type LedgerEntry } from "./spend.js"
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
  provider: "openai" | "openrouter" | "vercel"
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
  /** Force a syntactically valid JSON object response. */
  jsonMode?: boolean
  onUsage?: (r: LLMResult & { model: string; provider: string; purpose: string }) => void
}

const clients = new Map<string, OpenAI>()
function clientFor(spec: ModelSpec): OpenAI {
  const key = `${spec.provider}|${spec.baseURL ?? ""}|${spec.apiKey ?? "platform"}`
  let c = clients.get(key)
  if (!c) {
    const apiKey =
      spec.apiKey ??
      (spec.provider === "openrouter" ? process.env.OPENROUTER_API_KEY : spec.provider === "vercel" ? process.env.AI_GATEWAY_API_KEY : process.env.OPENAI_API_KEY)
    if (!apiKey) throw new Error(`No API key configured for ${spec.provider}`)
    c = new OpenAI({
      apiKey,
      maxRetries: 0, // we retry ourselves so every attempt is metered
      timeout: 120_000,
      ...(spec.baseURL
        ? { baseURL: spec.baseURL }
        : spec.provider === "openrouter"
          ? { baseURL: "https://openrouter.ai/api/v1" }
          : spec.provider === "vercel"
            ? { baseURL: "https://ai-gateway.vercel.sh/v1" }
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

/** Honour the provider's Retry-After (capped at 30 s); otherwise back off 1.5 s × attempt². */
export function retryDelayMs(err: unknown, attempt: number): number {
  const h = (err as { headers?: Headers | Record<string, string> }).headers
  const get = (k: string) => (h instanceof Headers ? h.get(k) : h?.[k]) ?? null
  const ms = Number(get("retry-after-ms"))
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 30_000)
  const sec = Number(get("retry-after"))
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 30_000)
  return 1500 * attempt * attempt
}

export async function chat(spec: ModelSpec, opts: CallOptions): Promise<LLMResult> {
  const ledger = getSpendLedger()
  // Who pays: the user's key (byok), Vercel's monthly free credit (free_credit), or our OpenAI key.
  const keyOwner: LedgerEntry["keyOwner"] = spec.apiKey ? "byok" : spec.provider === "vercel" ? "free_credit" : "platform"
  const price = priceFor(spec.model)
  // Worst case assumes zero cache hits and a full-length completion.
  const worstCase =
    (estimateInputTokens(opts.messages, opts.tools) * price.input + opts.maxOutputTokens * price.output) / 1_000_000
  // Reserve the worst case atomically (calls in flight count too); released on record or failure.
  const hold = await ledger.reserve(opts.taskId, keyOwner, worstCase, opts.taskCapUsd)
  try {
    return await callWithRetries(spec, opts, keyOwner, hold)
  } finally {
    await ledger.release(hold).catch(() => {})
  }
}

async function callWithRetries(spec: ModelSpec, opts: CallOptions, keyOwner: LedgerEntry["keyOwner"], hold: Hold): Promise<LLMResult> {
  const ledger = getSpendLedger()

  const client = clientFor(spec)
  const reasoning = isReasoningModel(spec.model)
  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: spec.model,
    messages: opts.messages,
    max_completion_tokens: opts.maxOutputTokens,
    // Per-task cache key: one key shared by every task overflows OpenAI's cache routing at scale.
    ...(spec.provider === "openai" && !spec.baseURL ? { prompt_cache_key: `pw-${opts.purpose}-${opts.taskId}` } : {}),
    ...(opts.tools && opts.tools.length > 0
      ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto", parallel_tool_calls: true }
      : {}),
    // temperature 0 only where it was tested (OpenAI non-reasoning); other providers keep their default.
    ...(reasoning ? { reasoning_effort: spec.reasoningEffort ?? "low" } : spec.provider === "openai" ? { temperature: 0 } : {}),
    ...(opts.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
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
      await ledger.record(
        {
          taskId: opts.taskId,
          keyOwner,
          provider: spec.provider,
          model: res.model ?? spec.model,
          purpose: opts.purpose,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          costUsd,
        },
        hold,
        { durationMs: Date.now() - started },
      )
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
      opts.onUsage?.({ ...result, model: spec.model, provider: spec.provider, purpose: opts.purpose })
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
      if (attempt < 3) await sleep(retryDelayMs(err, attempt))
    }
  }
  throw lastErr
}
