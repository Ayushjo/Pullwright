import type { WalletProvider } from '../../api/client'

// Mirrors backend/src/wallet/credentials.ts GUIDES patterns, so the paste box can name the provider as you paste.
const PATTERNS: [WalletProvider, RegExp][] = [
  ['openrouter', /^sk-or-(v1-)?[A-Za-z0-9_-]{20,}$/],
  ['gemini', /^(AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{20,})$/],
  ['groq', /^gsk_[A-Za-z0-9]{20,}$/],
  ['vercel', /^vck_[A-Za-z0-9]{20,}$/],
  ['openai', /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/],
]

export function detectProvider(key: string): WalletProvider | null {
  const k = key.trim()
  return PATTERNS.find(([, re]) => re.test(k))?.[0] ?? null
}

export const PROVIDER_NAMES: Record<WalletProvider, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  vercel: 'Vercel AI Gateway',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
}

/** Brand-ish accent per provider (used only for the small monogram tile). */
export const PROVIDER_TINT: Record<WalletProvider, string> = {
  gemini: 'bg-sky-50 text-sky-700 border-sky-200',
  groq: 'bg-orange-50 text-orange-700 border-orange-200',
  vercel: 'bg-neutral-100 text-neutral-900 border-neutral-300',
  openrouter: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  openai: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export const PROVIDER_MONO: Record<WalletProvider, string> = { gemini: 'G', groq: 'Gq', vercel: '▲', openrouter: 'OR', openai: 'AI' }
