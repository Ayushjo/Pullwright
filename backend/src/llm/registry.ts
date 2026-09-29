/**
 * What we know about each provider. Declarative so the router, adapters and wallet agree.
 *
 * Seed limits are starting points only: the quota tracker learns the real ones from response
 * headers and 429 bodies (free tiers change without notice — Google cut free quotas 50–80% in
 * Dec 2025). Sources and dates are noted per entry; "probed" = measured on the owner's keys.
 */

export type ProviderId =
  | "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "vercel"
  | "deepseek" | "nvidia" | "mistral" | "cerebras" | "huggingface" | "custom"

export type ProviderKind = "direct" | "gateway" | "open_host" | "custom"
export type DataPolicy = "no_train" | "trains" | "unknown"
export type ResetPolicy = "pt_midnight" | "utc_midnight" | "rolling"

export type Limits = { rpm?: number; rpd?: number; tpm?: number; tpd?: number; maxRequestTokens?: number }

export type ParamSupport = {
  maxTokensField: "max_completion_tokens" | "max_tokens"
  promptCacheKey: boolean
  parallelToolCalls: boolean
  toolChoiceRequired: boolean
  reasoningEffort: boolean
  jsonMode: boolean
}

export type ProviderDescriptor = {
  id: ProviderId
  label: string
  kind: ProviderKind
  baseURL?: string
  /** Env var holding the operator's own key for this provider, if the platform has one. */
  platformKeyEnv?: string
  /** Recognise a pasted key's provider (wallet UX). */
  keyPattern?: RegExp
  params: ParamSupport
  /** Whether prompts may be used for training, per tier (drives private-repo routing). */
  dataPolicy: { free: DataPolicy; paid: DataPolicy }
  /** Free-tier seed limits, per model or "*" for all models. */
  freeLimits?: Record<string, Limits>
  dailyReset: ResetPolicy
  /** Returns the provider's own cost per call in the response (use it instead of our estimate). */
  reportsCost: boolean
  notes?: string
}

const OPENAI_PARAMS: ParamSupport = { maxTokensField: "max_completion_tokens", promptCacheKey: true, parallelToolCalls: true, toolChoiceRequired: true, reasoningEffort: true, jsonMode: true }
const COMPAT_PARAMS: ParamSupport = { maxTokensField: "max_tokens", promptCacheKey: false, parallelToolCalls: true, toolChoiceRequired: true, reasoningEffort: false, jsonMode: true }

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  openai: {
    id: "openai", label: "OpenAI", kind: "direct", platformKeyEnv: "OPENAI_API_KEY",
    keyPattern: /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/, params: OPENAI_PARAMS,
    dataPolicy: { free: "no_train", paid: "no_train" }, dailyReset: "rolling", reportsCost: false,
  },
  anthropic: {
    id: "anthropic", label: "Anthropic (Claude)", kind: "direct", baseURL: "https://api.anthropic.com/v1",
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, params: { ...COMPAT_PARAMS, reasoningEffort: false },
    dataPolicy: { free: "no_train", paid: "no_train" }, dailyReset: "rolling", reportsCost: false,
    notes: "Native Messages API adapter needed for cache_control (≈90% of our tokens are cached).",
  },
  gemini: {
    id: "gemini", label: "Google Gemini", kind: "direct", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    platformKeyEnv: "GEMINI_API_KEY", keyPattern: /^(AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{20,})$/,
    params: { ...COMPAT_PARAMS, reasoningEffort: true },
    // Google pricing page: free tier data "used to improve our products": yes; paid: no.
    dataPolicy: { free: "trains", paid: "no_train" },
    // Sept 2026 reports + forum (not in Google's docs; AI Studio shows the live values).
    freeLimits: { "gemini-*-flash": { rpd: 20, rpm: 10 }, "gemini-*-flash-lite": { rpd: 500, rpm: 15 }, "*": { tpm: 250_000 } },
    dailyReset: "pt_midnight", reportsCost: false,
    notes: "Quota is per Google Cloud project, not per key. 2.5 models: 404 for new users (probed). Thought signatures required (probed).",
  },
  groq: {
    id: "groq", label: "Groq", kind: "direct", baseURL: "https://api.groq.com/openai/v1",
    platformKeyEnv: "GROQ_API_KEY", keyPattern: /^gsk_[A-Za-z0-9]{20,}$/, params: COMPAT_PARAMS,
    dataPolicy: { free: "no_train", paid: "no_train" },
    // Probed 2026-09-27 via x-ratelimit headers; any request > 8K tokens is rejected (413).
    freeLimits: { "*": { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200_000, maxRequestTokens: 8000 } },
    dailyReset: "rolling", reportsCost: false,
  },
  openrouter: {
    id: "openrouter", label: "OpenRouter", kind: "gateway", baseURL: "https://openrouter.ai/api/v1",
    platformKeyEnv: "OPENROUTER_API_KEY", keyPattern: /^sk-or-(v1-)?[A-Za-z0-9_-]{20,}$/, params: { ...COMPAT_PARAMS, reasoningEffort: true },
    // :free endpoints may log/train depending on the upstream; paid calls can require data_collection:"deny".
    dataPolicy: { free: "trains", paid: "unknown" },
    // Docs: 20 RPM; 50 RPD for :free models, 1000 RPD after ≥ $10 lifetime credits (account-wide).
    freeLimits: { "*:free": { rpm: 20, rpd: 50 } },
    dailyReset: "utc_midnight", reportsCost: true,
  },
  vercel: {
    id: "vercel", label: "Vercel AI Gateway", kind: "gateway", baseURL: "https://ai-gateway.vercel.sh/v1",
    platformKeyEnv: "AI_GATEWAY_API_KEY", keyPattern: /^vck_[A-Za-z0-9]{20,}$/, params: OPENAI_PARAMS,
    // Model list exposes no_training / zdr per model; free-tier credit covers OpenAI models only (probed 2026-09-29).
    dataPolicy: { free: "no_train", paid: "no_train" },
    // Free tier: 429 "this team's limit of 5 requests per minute (across all regions)" per model (seen 2026-09-29).
    freeLimits: { "*": { rpm: 5 } },
    dailyReset: "rolling", reportsCost: true,
    notes: "Free tier: monthly $5 credit, 5 RPM per model; DeepSeek, GLM and Gemini Flash-Lite return 403 'Free tier users do not have access' (probed).",
  },
  deepseek: {
    id: "deepseek", label: "DeepSeek", kind: "direct", baseURL: "https://api.deepseek.com/v1", keyPattern: /^sk-[a-f0-9]{32}$/,
    params: COMPAT_PARAMS, dataPolicy: { free: "unknown", paid: "unknown" }, dailyReset: "rolling", reportsCost: false,
  },
  nvidia: {
    id: "nvidia", label: "NVIDIA build", kind: "open_host", baseURL: "https://integrate.api.nvidia.com/v1", keyPattern: /^nvapi-[A-Za-z0-9_-]{20,}$/,
    params: COMPAT_PARAMS, dataPolicy: { free: "unknown", paid: "unknown" },
    freeLimits: { "*": { rpm: 40 } }, dailyReset: "rolling", reportsCost: false,
    notes: "Unverified (no key). Terms: development / testing / evaluation only.",
  },
  mistral: {
    id: "mistral", label: "Mistral", kind: "direct", baseURL: "https://api.mistral.ai/v1",
    params: COMPAT_PARAMS, dataPolicy: { free: "trains", paid: "no_train" }, dailyReset: "rolling", reportsCost: false,
    notes: "Unverified (no key). Free 'Experiment' tier ≈1 req/s; requires 9-char alphanumeric tool-call ids.",
  },
  cerebras: {
    id: "cerebras", label: "Cerebras", kind: "open_host", baseURL: "https://api.cerebras.ai/v1", keyPattern: /^csk-[A-Za-z0-9]{20,}$/,
    params: COMPAT_PARAMS, dataPolicy: { free: "unknown", paid: "unknown" }, dailyReset: "rolling", reportsCost: false,
    notes: "Unverified: free tier reported as ended.",
  },
  huggingface: {
    id: "huggingface", label: "Hugging Face router", kind: "gateway", baseURL: "https://router.huggingface.co/v1", keyPattern: /^hf_[A-Za-z0-9]{20,}$/,
    params: COMPAT_PARAMS, dataPolicy: { free: "unknown", paid: "unknown" }, dailyReset: "rolling", reportsCost: false,
    notes: "Free accounts get $0.10/month of credit.",
  },
  custom: {
    id: "custom", label: "Custom OpenAI-compatible endpoint", kind: "custom",
    params: COMPAT_PARAMS, dataPolicy: { free: "unknown", paid: "unknown" }, dailyReset: "rolling", reportsCost: false,
  },
}

/** Guess a pasted key's provider from its format (first match wins; ambiguous formats return null). */
export function detectProvider(key: string): ProviderId | null {
  const k = key.trim()
  const hits = (Object.values(PROVIDERS) as ProviderDescriptor[]).filter((p) => p.keyPattern?.test(k))
  if (hits.length === 1) return hits[0]!.id
  // sk-ant- and sk-or- also look like generic sk- keys: prefer the more specific pattern.
  const specific = hits.find((p) => p.id === "anthropic" || p.id === "openrouter")
  return specific?.id ?? null
}

/** Seed limits for a model on a provider's free tier (glob-ish keys: "*", "gemini-*-flash", "*:free"). */
export function seedLimits(provider: ProviderId, model: string): Limits {
  const table = PROVIDERS[provider].freeLimits ?? {}
  const glob = (pat: string) => new RegExp(`^${pat.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
  let out: Limits = {}
  // Least specific first so specific patterns win.
  for (const [pat, lim] of Object.entries(table).sort((a, b) => a[0].replace(/\*/g, "").length - b[0].replace(/\*/g, "").length)) {
    if (glob(pat).test(model)) out = { ...out, ...lim }
  }
  return out
}
