import OpenAI from "openai"
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions"
import { costOf, getSpendLedger, priceFor, SpendLimitError, type Hold, type LedgerEntry } from "./spend.js"
import logger from "../logger.js"
import { createHash } from "crypto"
import { PROVIDERS, type ProviderId } from "../llm/registry.js"
import { originOf, renderMessages } from "../llm/render.js"
import { assertSafeUrl, safeFetch } from "../llm/safeEndpoint.js"
import { claudeChat } from "../llm/anthropic.js"

/**
 * Thin, metered OpenAI-compatible chat client.
 *
 * Messages use the OpenAI Chat Completions shape as the canonical format. Every call is
 * priced from real `usage` (incl. cached input tokens) and written to the spend ledger;
 * a pessimistic pre-call estimate is checked against the task + global caps first.
 */

export type Msg = ChatCompletionMessageParam
/** A user message's content: plain text, or text and image parts. */
export type UserContent = string | ChatCompletionContentPart[]
export type ToolDef = ChatCompletionFunctionTool
/** extra: the provider's sidecar fields (Gemini thought signature); origin: which provider/model wrote it. */
export type ToolCall = { id: string; name: string; rawArgs: string; extra?: unknown; origin?: string }

export type ModelSpec = {
  provider: ProviderId
  model: string
  /** Reasoning models only (gpt-5 family, Gemini thinking). */
  reasoningEffort?: "minimal" | "low" | "medium" | "high"
  apiKey?: string // user's key (BYOK / free key); undefined → the platform's env key for this provider
  baseURL?: string
  /** Who pays; defaults: user key → byok, vercel → free_credit, otherwise platform. "free" is priced at $0. */
  spendClass?: LedgerEntry["keyOwner"]
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
  /** Attempts on this same lane (the gateway uses 1 and fails over instead). Default 3. */
  attempts?: number
  /** Per-call timeout; default 120 s (the gateway uses shorter per-lane timeouts). */
  timeoutMs?: number
  /** A shorter rendering of the same request, used only on a lane whose request cap the full one exceeds (Groq free: 8K). */
  compact?: Msg[]
  onUsage?: (r: LLMResult & { model: string; provider: string; purpose: string }) => void
}

const clients = new Map<string, OpenAI>()
function clientFor(spec: ModelSpec): OpenAI {
  const desc = PROVIDERS[spec.provider]
  const baseURL = spec.baseURL ?? desc.baseURL
  const key = `${spec.provider}|${baseURL ?? ""}|${spec.apiKey ? createHash("sha256").update(spec.apiKey).digest("hex").slice(0, 16) : "platform"}`
  let c = clients.get(key)
  if (!c) {
    const apiKey = spec.apiKey ?? (desc.platformKeyEnv ? process.env[desc.platformKeyEnv] : undefined)
    if (!apiKey) throw new Error(`No API key configured for ${spec.provider}`)
    // User-supplied endpoints go through the SSRF guard (private addresses refused at connect time).
    if (spec.provider === "custom") {
      if (!baseURL) throw new Error("A custom endpoint needs a base URL")
      assertSafeUrl(baseURL)
    }
    c = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000, ...(baseURL ? { baseURL } : {}), ...(spec.provider === "custom" ? { fetch: safeFetch } : {}) })
    if (clients.size > 500) clients.delete(clients.keys().next().value!) // bounded: user keys come and go
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

/** Who pays for a call on this spec. */
function spendClassOf(spec: ModelSpec): LedgerEntry["keyOwner"] {
  if (spec.spendClass) return spec.spendClass
  if (spec.apiKey) return "byok"
  return spec.provider === "vercel" ? "free_credit" : "platform"
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

/** The request body for one call, with only the parameters this provider accepts. */
export function buildRequestBody(spec: ModelSpec, opts: CallOptions): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const params = PROVIDERS[spec.provider].params
  // Gemini thinking models take reasoning_effort; Gemma on the same API has no thinking and rejects it (400).
  const reasoning = isReasoningModel(spec.model) || (spec.provider === "gemini" && /^gemini-/.test(spec.model) && spec.reasoningEffort !== undefined)
  const target = { provider: spec.provider, model: spec.model }
  // Only send what this provider accepts (unknown parameters are rejected by some, ignored by others).
  return {
    model: spec.model,
    messages: renderMessages(opts.messages, target),
    [params.maxTokensField]: opts.maxOutputTokens,
    // Per-task cache key: one key shared by every task overflows OpenAI's cache routing at scale.
    ...(params.promptCacheKey && spec.provider === "openai" ? { prompt_cache_key: `pw-${opts.purpose}-${opts.taskId}` } : {}),
    ...(opts.tools && opts.tools.length > 0
      ? {
          tools: opts.tools,
          tool_choice: opts.toolChoice === "required" && !params.toolChoiceRequired ? "auto" : (opts.toolChoice ?? "auto"),
          // Not to OpenRouter: free endpoints don't list parallel_tool_calls, and with require_parameters every
          // one was filtered out (404 "No endpoints found…", measured 2026-10-04). Parallel calls are the default there.
          ...(params.parallelToolCalls && spec.provider !== "openrouter" ? { parallel_tool_calls: true } : {}),
        }
      : {}),
    // temperature 0 only where it was tested (OpenAI non-reasoning); other providers keep their default.
    ...(reasoning && params.reasoningEffort ? { reasoning_effort: spec.reasoningEffort ?? "low" } : !reasoning && spec.provider === "openai" ? { temperature: 0 } : {}),
    ...(opts.jsonMode && params.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    // OpenRouter: keep one upstream per task so the prompt cache keeps hitting (sticky routing is keyed
    // by session_id; provider.order would disable it), and only route to upstreams that support every
    // parameter we send (tools). Model fallbacks stay ours — no `models` array — so only measured models run.
    ...(spec.provider === "openrouter" ? { session_id: `pw-${opts.taskId}`, provider: { require_parameters: true } } : {}),
  } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
}

export async function chat(spec: ModelSpec, opts: CallOptions): Promise<LLMResult> {
  const ledger = getSpendLedger()
  // Who pays: the user's key (byok), Vercel's monthly free credit (free_credit), or our OpenAI key.
  const keyOwner = spendClassOf(spec)
  // Free-tier lanes cost nothing; everything else is priced (unknown models pessimistically).
  const price = keyOwner === "free" ? { input: 0, cachedInput: 0, output: 0 } : priceFor(spec.model, spec.provider)
  // Worst case assumes zero cache hits and a full-length completion.
  const worstCase =
    (estimateInputTokens(opts.messages, opts.tools) * price.input + opts.maxOutputTokens * price.output) / 1_000_000
  // Reserve the worst case atomically (calls in flight count too); released on record or failure.
  const hold = await ledger.reserve(opts.taskId, keyOwner, worstCase, opts.taskCapUsd, keyOwner === "pool" ? spec.provider : undefined)
  try {
    return await callWithRetries(spec, opts, keyOwner, hold)
  } finally {
    await ledger.release(hold).catch(() => {})
  }
}

async function callWithRetries(spec: ModelSpec, opts: CallOptions, keyOwner: LedgerEntry["keyOwner"], hold: Hold): Promise<LLMResult> {
  const ledger = getSpendLedger()
  if (spec.provider === "anthropic") return callClaude(spec, opts, keyOwner, hold)

  const client = clientFor(spec)
  const target = { provider: spec.provider, model: spec.model }
  const body = buildRequestBody(spec, opts)

  const attempts = opts.attempts ?? 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now()
    try {
      const res = await client.chat.completions.create(body, { timeout: opts.timeoutMs ?? 120_000 })
      const choice = res.choices[0]
      if (!choice) throw new Error("LLM returned no choices")
      const inputTokens = res.usage?.prompt_tokens ?? 0
      const cachedInputTokens = res.usage?.prompt_tokens_details?.cached_tokens ?? 0
      const outputTokens = res.usage?.completion_tokens ?? 0
      // Gateways (OpenRouter, Vercel) report what they actually charged; prefer that over our estimate.
      const reported = Number((res.usage as { cost?: number } | undefined)?.cost)
      const costUsd =
        keyOwner === "free" ? 0 : PROVIDERS[spec.provider].reportsCost && Number.isFinite(reported) ? reported : costOf(spec.model, { inputTokens, cachedInputTokens, outputTokens }, spec.provider)
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
        .map((tc) => {
          const extra = (tc as { extra_content?: unknown }).extra_content
          return { id: tc.id, name: tc.function.name, rawArgs: tc.function.arguments ?? "", origin: originOf(target), ...(extra !== undefined ? { extra } : {}) }
        })
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
      if (attempts > 1) logger.warn(`LLM call failed (attempt ${attempt}/${attempts}): ${(err as Error).message}`)
      if (attempt < attempts) await sleep(retryDelayMs(err, attempt))
    }
  }
  throw lastErr
}

/** Claude through the native Messages API (llm/anthropic.ts): same metering and result shape as chat(). */
async function callClaude(spec: ModelSpec, opts: CallOptions, keyOwner: LedgerEntry["keyOwner"], hold: Hold): Promise<LLMResult> {
  const ledger = getSpendLedger()
  const apiKey = spec.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("No API key configured for anthropic")
  const effort = (process.env.PW_ANTHROPIC_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "medium"
  const attempts = opts.attempts ?? 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now()
    try {
      // The canonical history, unrendered: the adapter needs each Claude turn's raw blocks (extra_content).
      const r = await claudeChat({
        model: spec.model,
        apiKey,
        messages: opts.messages,
        ...(opts.tools ? { tools: opts.tools } : {}),
        maxOutputTokens: opts.maxOutputTokens,
        ...(opts.jsonMode ? { jsonMode: true } : {}),
        ...(opts.toolChoice === "required" ? { requireTool: true } : {}),
        effort,
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      })
      const costUsd = keyOwner === "free" ? 0 : r.costUsd
      await ledger.record(
        { taskId: opts.taskId, keyOwner, provider: "anthropic", model: r.model, purpose: opts.purpose, inputTokens: r.usage.inputTokens, cachedInputTokens: r.usage.cachedInputTokens, outputTokens: r.usage.outputTokens, costUsd },
        hold,
        { durationMs: Date.now() - started },
      )
      if (r.transformations.length) logger.info(`claude ${opts.taskId} ${opts.purpose}: input_transformations ${JSON.stringify(r.transformations).slice(0, 300)}`)
      const target = { provider: spec.provider, model: spec.model }
      const result: LLMResult = {
        text: r.text,
        toolCalls: r.toolCalls.map((tc) => ({ ...tc, origin: originOf(target) })),
        finishReason: r.finishReason,
        costUsd,
        inputTokens: r.usage.inputTokens,
        cachedInputTokens: r.usage.cachedInputTokens,
        outputTokens: r.usage.outputTokens,
        durationMs: Date.now() - started,
      }
      opts.onUsage?.({ ...result, model: r.model, provider: spec.provider, purpose: opts.purpose })
      return result
    } catch (err) {
      if (err instanceof SpendLimitError) throw err
      lastErr = err
      const status = (err as { status?: number }).status
      // 529 overloaded and 429 are retryable; 4xx request errors are not.
      const retryable = status === 429 || status === 529 || (status !== undefined && status >= 500) || status === undefined
      if (!retryable) throw err
      if (attempts > 1) logger.warn(`Claude call failed (attempt ${attempt}/${attempts}): ${(err as Error).message}`)
      if (attempt < attempts) await sleep(retryDelayMs(err, attempt))
    }
  }
  throw lastErr
}
