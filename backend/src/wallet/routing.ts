import type { Lane } from "../llm/gateway.js"
import type { WalletProvider } from "./credentials.js"

/**
 * Which of a user's keys serve each role, in order (free → free credit → the user's paid keys).
 * Orders follow the P2 measurements (docs/architecture/qualification.md, free-without-credit.md):
 * - plan / review: gpt-5-mini on the Vercel free credit is the measured best; then the Gemini Flash pool
 *   (review: Groq gpt-oss-120b first — 1/9 false approvals vs Flash 4/14); paid keys last.
 * - execute: Gemini Flash-Lite (25/26 with a credit planner), then the credit, then paid.
 * - vision: Groq qwen3.8-27b and Flash-Lite read screenshots exactly; gpt-oss can't.
 * Flash-Lite never reviews (8/11 false approvals).
 */
export type Role = "plan" | "run" | "judge" | "vision"

type Key = { provider: WalletProvider; key: string; tier: string; meta: Record<string, unknown> | null }

const FLASH_POOL = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.7-flash"]
const LITE_POOL = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]

/** Lanes that may use prompts for training: only allowed on private repos with the user's consent. */
const TRAINS = (k: Key) => k.provider === "gemini" || (k.provider === "openrouter" && k.tier === "free")

export function walletLanes(userId: string, keys: Key[], role: Role, opts: { privateRepo?: boolean; allowTraining?: boolean } = {}): Lane[] {
  const usable = keys.filter((k) => !(opts.privateRepo && !opts.allowTraining && TRAINS(k)))
  const by = (p: WalletProvider) => usable.find((k) => k.provider === p)
  const lane = (k: Key, model: string, spendClass: Lane["spendClass"]): Lane => ({
    credentialId: `user:${userId}:${k.provider}`,
    ownerUserId: userId,
    provider: k.provider,
    model,
    apiKey: k.key,
    spendClass,
    reasoningEffort: "low",
  })
  const vercel = by("vercel")
  // A spent free credit answers 402; skip it up front when the last check says it's nearly empty.
  const credit = vercel && !(typeof vercel.meta?.balanceUsd === "number" && (vercel.meta.balanceUsd as number) < 0.03) ? vercel : undefined
  const gemini = by("gemini")
  const groq = by("groq")
  const openrouter = by("openrouter")
  const openrouterPaid = openrouter && openrouter.tier === "paid" ? openrouter : undefined
  const openai = by("openai")

  const out: Lane[] = []
  const add = (k: Key | undefined, models: string[], cls: Lane["spendClass"]) => {
    if (k) for (const m of models) out.push(lane(k, m, cls))
  }
  switch (role) {
    case "plan":
      add(credit, ["openai/gpt-5-mini"], "free_credit")
      add(gemini, FLASH_POOL, "free")
      add(openrouterPaid, ["openai/gpt-5-mini"], "byok")
      add(openai, ["gpt-5-mini"], "byok")
      break
    case "run":
      add(gemini, LITE_POOL, "free")
      add(credit, ["openai/gpt-5-mini"], "free_credit")
      add(groq, ["qwen/qwen3.8-27b"], "free") // only when the prompt fits Groq's 8K cap (the gateway skips otherwise)
      add(openrouterPaid, ["openai/gpt-5-mini"], "byok")
      add(openai, ["gpt-5-mini"], "byok")
      break
    case "judge":
      add(credit, ["openai/gpt-5-mini"], "free_credit")
      add(groq, ["openai/gpt-oss-120b"], "free")
      add(gemini, FLASH_POOL.slice(0, 3), "free")
      add(openrouterPaid, ["openai/gpt-5-mini"], "byok")
      add(openai, ["gpt-5-mini"], "byok")
      break
    case "vision":
      add(groq, ["qwen/qwen3.8-27b"], "free")
      add(gemini, LITE_POOL.slice(0, 1), "free")
      add(credit, ["openai/gpt-5-mini"], "free_credit")
      add(openai, ["gpt-5-mini"], "byok")
      break
  }
  return out
}

/** What a set of keys can do — for the wallet UI and admission ("Groq alone can't plan"). */
/** Shown when a private repo would need a key whose free tier trains on prompts (Gemini, OpenRouter free). */
export const PRIVATE_TRAINING_MSG =
  "This repo is private, and your free keys that can plan and write code (Gemini, OpenRouter free models) may use prompts for training. Allow it for this task, or add a key that doesn't train (Vercel, OpenAI)."

export function walletCapability(keys: Key[], opts: { privateRepo?: boolean; allowTraining?: boolean } = {}) {
  const has = (r: Role) => walletLanes("x", keys, r, opts).length > 0
  const canRun = has("plan") && has("run")
  const free = keys.length > 0 && keys.every((k) => k.provider !== "openai" && !(k.provider === "openrouter" && k.tier === "paid"))
  return {
    canRun,
    canReview: has("judge"),
    canReadImages: has("vision"),
    allFree: free,
    missing: canRun ? null : keys.some((k) => k.provider === "groq") ? "Groq can review but can't plan or write code — add a free Gemini key." : "Add a free Gemini key to start.",
  }
}
