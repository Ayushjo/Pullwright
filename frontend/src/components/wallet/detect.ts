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

/** Logo colour per provider (Gemini's mark carries its own gradient). */
export const PROVIDER_TINT: Record<WalletProvider, string> = {
  gemini: 'text-[#3186FF]',
  groq: 'text-[#F55036]',
  vercel: 'text-foreground',
  openrouter: 'text-[#6467F2]',
  openai: 'text-foreground',
}
