import type { Redis } from "ioredis"

/**
 * Provider-wide circuit breaker per (provider, model). When ≥ 3 *different* credentials see
 * outage-type failures (5xx, 503 "high demand", timeouts) on the same model within 60 s, the model is
 * treated as down for everyone: open for 60 s, doubling on repeated opens up to 5 min. Sharing this
 * across users is safe (it says nothing about anyone's content) and saves everyone's scarce free
 * quota during Gemini's "high demand" episodes. Key-specific problems (401, 402) are not counted here.
 */

const WINDOW_MS = 60_000
const THRESHOLD = 3
const BASE_OPEN_MS = 60_000
const MAX_OPEN_MS = 5 * 60_000

const k = {
  fails: (m: string) => `pw:cbf:${m}`, // zset credentialId → last failure ts
  open: (m: string) => `pw:cb:${m}`,
  streak: (m: string) => `pw:cbs:${m}`, // consecutive opens (backoff)
}

export class CircuitBreaker {
  constructor(private redis: Redis) {}

  async isOpen(providerModel: string): Promise<{ open: boolean; retryInMs: number }> {
    const pttl = await this.redis.pttl(k.open(providerModel))
    return pttl > 0 ? { open: true, retryInMs: pttl } : { open: false, retryInMs: 0 }
  }

  /** Record an outage-type failure seen with this credential; opens the breaker at the threshold. */
  async failure(providerModel: string, credentialId: string, now = Date.now()): Promise<boolean> {
    const key = k.fails(providerModel)
    const [, , [, distinct]] = (await this.redis
      .multi()
      .zadd(key, now, credentialId)
      .zremrangebyscore(key, "-inf", now - WINDOW_MS)
      .zcard(key)
      .pexpire(key, WINDOW_MS * 2)
      .exec()) as [unknown, unknown, [unknown, number], unknown]
    if (Number(distinct) < THRESHOLD || (await this.isOpen(providerModel)).open) return false
    const streak = await this.redis.incr(k.streak(providerModel))
    await this.redis.expire(k.streak(providerModel), 3600)
    const openMs = Math.min(MAX_OPEN_MS, BASE_OPEN_MS * 2 ** (streak - 1))
    await this.redis.multi().set(k.open(providerModel), "1", "PX", openMs).del(key).exec()
    return true
  }

  /** A success closes the streak (next outage starts again at 60 s). */
  async success(providerModel: string): Promise<void> {
    await this.redis.del(k.streak(providerModel))
  }
}
