import type { Redis } from "ioredis"
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit"
import { createRedisClient } from "../config/redis.js"

/** Increment and, on the window's first hit, start its expiry — atomically. Returns {hits, pttl}. */
const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`

/**
 * express-rate-limit store backed by Redis, so every API replica shares one count per user
 * (the default MemoryStore counts per process, which multiplies the limit by the replica count).
 */
export class RedisRateStore implements Store {
  localKeys = false
  prefix: string
  private windowMs = 60_000
  private redis: Redis

  constructor(prefix: string, redis?: Redis) {
    this.prefix = `pw:rl:${prefix}:`
    this.redis = redis ?? createRedisClient()
  }

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const [hits, pttl] = (await this.redis.eval(HIT, 1, this.prefix + key, this.windowMs)) as [number, number]
    return { totalHits: Number(hits), resetTime: new Date(Date.now() + Math.max(0, Number(pttl))) }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const [hits, pttl] = await Promise.all([this.redis.get(this.prefix + key), this.redis.pttl(this.prefix + key)])
    return hits === null ? undefined : { totalHits: Number(hits), resetTime: new Date(Date.now() + Math.max(0, pttl)) }
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(this.prefix + key)
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.prefix + key)
  }
}
