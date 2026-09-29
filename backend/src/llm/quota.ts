import type { Redis } from "ioredis"
import type { Limits, ResetPolicy } from "./registry.js"

/**
 * Per lane (credential × model) quota in Redis, shared by every worker.
 *
 * reserve() checks every window and books the request atomically (Lua), so one user's parallel
 * tasks can't both spend the last free request. Limits come from the registry's seeds, overridden by
 * what we learn from providers (headers, 429 bodies). Windows are fixed (minute / provider day), which
 * is conservative for rolling limits.
 */

export type Scope = string // e.g. "platform:gemini|gemini-3.8-flash", "cred_123|@free"
export type Window = "rpm" | "tpm" | "rpd" | "tpd"
export type ReserveResult = { ok: true } | { ok: false; reason: Window | "cooldown" | "too_large"; retryInMs: number }

const k = {
  lim: (s: Scope) => `pw:qlim:${s}`,
  cool: (s: Scope) => `pw:qcool:${s}`,
  win: (s: Scope, w: Window, id: string) => `pw:q:${s}:${w}:${id}`,
}

/**
 * KEYS: cooldown, reqMin, tokMin, reqDay, tokDay, learnedLimits
 * ARGV: estTokens, rpm, tpm, rpd, tpd, maxRequestTokens (-1 = unlimited), msToMinuteEnd, msToDayEnd
 */
const RESERVE = `
local pttl = redis.call('PTTL', KEYS[1])
if pttl > 0 then return {0, 'cooldown', pttl} end
local learned = redis.call('HGETALL', KEYS[6])
local L = {}
for i = 1, #learned, 2 do L[learned[i]] = tonumber(learned[i + 1]) end
local function lim(name, argv) local v = L[name] or tonumber(argv) if v == nil or v < 0 then return nil end return v end
local est = tonumber(ARGV[1])
local maxReq = lim('maxRequestTokens', ARGV[6])
if maxReq and est > maxReq then return {0, 'too_large', -1} end
local rpm, tpm, rpd, tpd = lim('rpm', ARGV[2]), lim('tpm', ARGV[3]), lim('rpd', ARGV[4]), lim('tpd', ARGV[5])
local rm = tonumber(redis.call('GET', KEYS[2]) or '0')
local tm = tonumber(redis.call('GET', KEYS[3]) or '0')
local rd = tonumber(redis.call('GET', KEYS[4]) or '0')
local td = tonumber(redis.call('GET', KEYS[5]) or '0')
if rpd and rd + 1 > rpd then return {0, 'rpd', tonumber(ARGV[8])} end
if tpd and td + est > tpd then return {0, 'tpd', tonumber(ARGV[8])} end
if rpm and rm + 1 > rpm then return {0, 'rpm', tonumber(ARGV[7])} end
if tpm and tm + est > tpm then return {0, 'tpm', tonumber(ARGV[7])} end
redis.call('INCR', KEYS[2]); redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[7]) + 5000)
redis.call('INCRBY', KEYS[3], est); redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[7]) + 5000)
redis.call('INCR', KEYS[4]); redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[8]) + 3600000)
redis.call('INCRBY', KEYS[5], est); redis.call('PEXPIRE', KEYS[5], tonumber(ARGV[8]) + 3600000)
return {1}`

/** Milliseconds until the next reset of a provider's daily window, and that window's id. */
export function dayWindow(policy: ResetPolicy, now = Date.now()): { id: string; msToEnd: number } {
  if (policy === "pt_midnight") {
    // Midnight in America/Los_Angeles, DST-safe: find the LA wall-clock time now, then the gap to 24:00.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(now))
        .map((p) => [p.type, p.value]),
    )
    const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + (now % 1000)
    return { id: `pt${parts.year}${parts.month}${parts.day}`, msToEnd: 86_400_000 - elapsed }
  }
  const d = new Date(now)
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  return { id: `utc${d.toISOString().slice(0, 10).replace(/-/g, "")}`, msToEnd: end - now }
}

export class QuotaTracker {
  constructor(private redis: Redis) {}

  async reserve(scope: Scope, estTokens: number, seed: Limits, reset: ResetPolicy, now = Date.now()): Promise<ReserveResult> {
    const minuteId = String(Math.floor(now / 60_000))
    const day = dayWindow(reset, now)
    const arg = (v?: number) => (v === undefined ? -1 : v)
    const res = (await this.redis.eval(
      RESERVE, 6,
      k.cool(scope), k.win(scope, "rpm", minuteId), k.win(scope, "tpm", minuteId), k.win(scope, "rpd", day.id), k.win(scope, "tpd", day.id), k.lim(scope),
      Math.max(0, Math.round(estTokens)), arg(seed.rpm), arg(seed.tpm), arg(seed.rpd), arg(seed.tpd), arg(seed.maxRequestTokens),
      60_000 - (now % 60_000), day.msToEnd,
    )) as [number, string?, number?]
    if (Number(res[0]) === 1) return { ok: true }
    return { ok: false, reason: res[1] as Window | "cooldown" | "too_large", retryInMs: Number(res[2]) }
  }

  /** Correct the token counters once the provider reports actual usage. */
  async reconcile(scope: Scope, estTokens: number, actualTokens: number, reset: ResetPolicy, now = Date.now()) {
    const delta = Math.round(actualTokens - estTokens)
    if (!delta) return
    const minuteId = String(Math.floor(now / 60_000))
    const day = dayWindow(reset, now)
    await this.redis.multi().incrby(k.win(scope, "tpm", minuteId), delta).incrby(k.win(scope, "tpd", day.id), delta).exec()
  }

  /** Pause a lane (rate limit, overload, daily exhaustion until reset). Never shortens an existing cooldown. */
  async cooldown(scope: Scope, ms: number) {
    if (ms <= 0) return
    const cur = await this.redis.pttl(k.cool(scope))
    if (cur >= ms) return
    await this.redis.set(k.cool(scope), "1", "PX", Math.round(ms))
  }

  /** Remember limits learned from the provider (headers, 429 bodies); they override the seeds. */
  async learn(scope: Scope, limits: Limits) {
    const entries = Object.entries(limits).filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    if (!entries.length) return
    await this.redis.multi().hset(k.lim(scope), Object.fromEntries(entries)).expire(k.lim(scope), 30 * 24 * 3600).exec()
  }

  async learned(scope: Scope): Promise<Limits> {
    const h = await this.redis.hgetall(k.lim(scope))
    return Object.fromEntries(Object.entries(h).map(([key, v]) => [key, Number(v)])) as Limits
  }
}
