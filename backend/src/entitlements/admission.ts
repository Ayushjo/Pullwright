import type { Redis } from "ioredis"

/**
 * Admission (P3): how many tasks a user may start per rolling 24 h, and how many may be in progress at
 * once (running *or* parked waiting for quota). One Lua script prunes the window, checks both limits and
 * records the start, so two quick submits can't both slip through.
 *
 * A start that never reached execution (clone error, cancelled at plan approval) is refunded — the free
 * plan's "3 tasks a day" means 3 tasks that actually ran.
 */

export type PlanLimits = { tasksPerDay: number; maxActive: number }

export function limitsFor(tier: "free" | "pro"): PlanLimits {
  const n = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d)
  return tier === "pro"
    ? { tasksPerDay: n(process.env.PRO_TASKS_PER_DAY, 25), maxActive: n(process.env.PRO_MAX_ACTIVE, 3) }
    : { tasksPerDay: n(process.env.FREE_TASKS_PER_DAY, 3), maxActive: n(process.env.FREE_MAX_ACTIVE, 1) }
}

export const WINDOW_MS = 24 * 3_600_000

export const admissionKeys = {
  starts: (userId: string) => `pw:adm:starts:${userId}`,
  active: (userId: string) => `pw:adm:active:${userId}`,
}

/** KEYS: starts (ZSET taskId→ms), active (SET). ARGV: now, window, perDay, maxActive, taskId */
const ADMIT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('SCARD', KEYS[2]) >= tonumber(ARGV[4]) then return {0, 'active_limit', 0} end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, 'daily_limit', tonumber(oldest[2]) + tonumber(ARGV[2])}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[5])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[5])
return {1, 'ok', 0}`

export type AdmitResult = { ok: true } | { ok: false; reason: "active_limit" } | { ok: false; reason: "daily_limit"; nextSlotAt: number }

export async function admit(redis: Redis, userId: string, taskId: string, limits: PlanLimits, now = Date.now()): Promise<AdmitResult> {
  const [ok, reason, next] = (await redis.eval(ADMIT, 2, admissionKeys.starts(userId), admissionKeys.active(userId), now, WINDOW_MS, limits.tasksPerDay, limits.maxActive, taskId)) as [number, string, number]
  if (ok === 1) return { ok: true }
  return reason === "daily_limit" ? { ok: false, reason: "daily_limit", nextSlotAt: Number(next) } : { ok: false, reason: "active_limit" }
}

/** Give back a start that never ran, and free its active slot. */
export async function refund(redis: Redis, userId: string, taskId: string) {
  await redis.multi().zrem(admissionKeys.starts(userId), taskId).srem(admissionKeys.active(userId), taskId).exec()
}

/** Drop active-slot entries whose task no longer holds one (finished, waiting on the user, or expired). */
export async function pruneActive(redis: Redis, userId: string, holds: (taskId: string) => Promise<boolean>) {
  for (const id of await redis.smembers(admissionKeys.active(userId))) {
    if (!(await holds(id))) await redis.srem(admissionKeys.active(userId), id)
  }
}

/** Starts used in the current window, for the capacity meter ("2 of 3 free tasks left today"). */
export async function startsUsed(redis: Redis, userId: string, now = Date.now()): Promise<number> {
  return redis.zcount(admissionKeys.starts(userId), now - WINDOW_MS + 1, "+inf")
}
