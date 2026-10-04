import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import { decrypt, encrypt } from "../auth/session.js"
import { openRouterKeyInfo } from "../billing/index.js"

/**
 * Wallet (P4): the model keys a user brings. One key per provider (a second key from the same account adds
 * no quota). Each key is checked with a free provider call when saved, which also tells us its tier and,
 * for gateways, the credit left. Keys are encrypted at rest and only decrypted on the worker for a task.
 */

export type WalletProvider = "gemini" | "groq" | "openrouter" | "vercel" | "openai"
export const WALLET_PROVIDERS: WalletProvider[] = ["gemini", "groq", "vercel", "openrouter", "openai"]

export type ProviderGuide = {
  id: WalletProvider
  name: string
  /** What this key does for the user, in one line. */
  role: string
  free: boolean
  cardNeeded: boolean
  keyUrl: string
  steps: string[]
  pattern: RegExp
  placeholder: string
}

export const GUIDES: Record<WalletProvider, ProviderGuide> = {
  gemini: {
    id: "gemini", name: "Google Gemini", role: "Plans and writes the code for free (the one key you need)", free: true, cardNeeded: false,
    keyUrl: "https://aistudio.google.com/apikey",
    steps: ["Open Google AI Studio and sign in with any Google account", "Click “Create API key”", "Copy the key and paste it here"],
    pattern: /^(AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{20,})$/, placeholder: "AIza… or AQ.…",
  },
  groq: {
    id: "groq", name: "Groq", role: "Reviews patches and reads screenshots for free", free: true, cardNeeded: false,
    keyUrl: "https://console.groq.com/keys",
    steps: ["Sign up at console.groq.com (email, no card)", "Open “API Keys” → “Create API Key”", "Copy it and paste it here"],
    pattern: /^gsk_[A-Za-z0-9]{20,}$/, placeholder: "gsk_…",
  },
  vercel: {
    id: "vercel", name: "Vercel AI Gateway", role: "$5 free credit every month — plans and reviews with a stronger model", free: true, cardNeeded: false,
    keyUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys",
    steps: ["Sign in to Vercel (free Hobby account)", "Open AI Gateway → API Keys → Create key", "Copy it and paste it here"],
    pattern: /^vck_[A-Za-z0-9]{20,}$/, placeholder: "vck_…",
  },
  openrouter: {
    id: "openrouter", name: "OpenRouter", role: "One key for many models; free models included", free: true, cardNeeded: false,
    keyUrl: "https://openrouter.ai/settings/keys",
    steps: ["Sign in at openrouter.ai", "Open Settings → Keys → Create key", "Copy it and paste it here"],
    pattern: /^sk-or-(v1-)?[A-Za-z0-9_-]{20,}$/, placeholder: "sk-or-v1-…",
  },
  openai: {
    id: "openai", name: "OpenAI", role: "Your own paid key — used after the free ones", free: false, cardNeeded: true,
    keyUrl: "https://platform.openai.com/api-keys",
    steps: ["Open platform.openai.com → API keys", "Create a new secret key", "Copy it and paste it here"],
    pattern: /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/, placeholder: "sk-…",
  },
}

export type CheckResult = {
  tier: "free" | "paid" | "free_credit" | "unknown"
  dataPolicy: "trains" | "no_train" | "unknown"
  meta: Record<string, unknown>
}

type Fetch = typeof fetch

/** Free check per provider (lists models or reads balance — never spends tokens). */
export async function checkKey(provider: WalletProvider, key: string, fetchImpl: Fetch = fetch): Promise<{ error: string } | CheckResult> {
  const get = (url: string, headers: Record<string, string>) => fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) })
  try {
    let res: Response
    switch (provider) {
      case "gemini":
        res = await get("https://generativelanguage.googleapis.com/v1beta/openai/models", { Authorization: `Bearer ${key}` })
        break
      case "groq":
        res = await get("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` })
        break
      case "vercel":
        res = await get("https://ai-gateway.vercel.sh/v1/credits", { Authorization: `Bearer ${key}` })
        break
      case "openrouter":
        res = await get("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` })
        break
      case "openai":
        res = await get("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` })
        break
    }
    if (res.status === 401 || res.status === 403) return { error: "That key was rejected by the provider. Check you copied all of it." }
    if (!res.ok) return { error: `The provider answered ${res.status} — try again in a moment.` }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    switch (provider) {
      case "gemini":
        // Free-tier prompts may be used to improve Google's products (pricing page); a paid key can't be told
        // apart without spending, so it's treated as free until a 429 or billing info says otherwise.
        return { tier: "free", dataPolicy: "trains", meta: { models: Array.isArray(body?.data) ? (body!.data as unknown[]).length : null } }
      case "groq":
        return { tier: "free", dataPolicy: "no_train", meta: {} }
      case "vercel": {
        const balance = Number(body?.balance)
        const used = Number(body?.total_used)
        return { tier: "free_credit", dataPolicy: "no_train", meta: { balanceUsd: Number.isFinite(balance) ? balance : null, usedUsd: Number.isFinite(used) ? used : null } }
      }
      case "openrouter": {
        const info = openRouterKeyInfo(body)
        return { tier: info.tier === "unknown" ? "unknown" : info.tier, dataPolicy: info.tier === "free" ? "trains" : "unknown", meta: { ...info } }
      }
      case "openai":
        return { tier: "paid", dataPolicy: "no_train", meta: {} }
    }
  } catch {
    return { error: "Couldn't reach the provider to check the key. Try again." }
  }
}

export function detectWalletProvider(key: string): WalletProvider | null {
  const k = key.trim()
  // sk-or- also matches OpenAI's generic sk- pattern: test the specific one first.
  if (GUIDES.openrouter.pattern.test(k)) return "openrouter"
  return (WALLET_PROVIDERS.find((p) => p !== "openrouter" && GUIDES[p].pattern.test(k)) ?? null)
}

export type WalletKey = {
  provider: WalletProvider
  last4: string
  tier: string
  status: string
  dataPolicy: string
  meta: Record<string, unknown> | null
  createdAt: Date
  lastUsedAt: Date | null
  lastCheckedAt: Date | null
}

export async function listWallet(userId: string): Promise<WalletKey[]> {
  const rows = await getPrisma().apiKey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
  return rows
    .filter((r) => (WALLET_PROVIDERS as string[]).includes(r.provider))
    .map((r) => ({
      provider: r.provider as WalletProvider,
      last4: r.last4,
      tier: r.tier,
      status: r.status,
      dataPolicy: r.dataPolicy,
      meta: (r.meta as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      lastCheckedAt: r.lastCheckedAt,
    }))
}

export async function saveWalletKey(userId: string, provider: WalletProvider, key: string, check: CheckResult) {
  const data = {
    encryptedKey: encrypt(key),
    last4: key.slice(-4),
    tier: check.tier,
    status: "active",
    dataPolicy: check.dataPolicy,
    meta: check.meta as object,
    lastCheckedAt: new Date(),
  }
  await getPrisma().apiKey.upsert({ where: { userId_provider: { userId, provider } }, create: { userId, provider, ...data }, update: data })
}

export async function deleteWalletKey(userId: string, provider: WalletProvider) {
  await getPrisma().apiKey.deleteMany({ where: { userId, provider } })
}

export async function markKeyStatus(userId: string, provider: WalletProvider, status: "active" | "revoked" | "out_of_funds") {
  await getPrisma().apiKey.updateMany({ where: { userId, provider }, data: { status } })
}

/** Worker-side: the user's usable keys, decrypted. Never logged, never sent to the client. */
export async function loadWallet(userId: string): Promise<{ provider: WalletProvider; key: string; tier: string; meta: Record<string, unknown> | null }[]> {
  if (!isDatabaseEnabled()) return []
  const rows = await getPrisma().apiKey.findMany({ where: { userId, status: "active" } })
  return rows
    .filter((r) => (WALLET_PROVIDERS as string[]).includes(r.provider))
    .map((r) => ({ provider: r.provider as WalletProvider, key: decrypt(r.encryptedKey), tier: r.tier, meta: (r.meta as Record<string, unknown> | null) ?? null }))
}
