import { Redis } from "ioredis"
import type { TaskEvent } from "./types.js"
import { createRedisClient } from "../config/redis.js"
import { appendEventToDb, clearEventsInDb, listEventsFromDb } from "../repositories/eventRepository.js"
import { isDatabaseEnabled } from "../db/prisma.js"

export class EventLog {
  private redis: Redis
  private TTL = 60 * 60 * 24 // 24 hours

  constructor() {
    this.redis = createRedisClient()
  }

  private key(taskId: string) {
    return `events:${taskId}`
  }

  async append(taskId: string, event: TaskEvent): Promise<number> {
    const len = await this.redis.rpush(this.key(taskId), JSON.stringify(event))
    await this.redis.expire(this.key(taskId), this.TTL)
    const sequence = len - 1 // 0-indexed position

    if (isDatabaseEnabled()) {
      void appendEventToDb(taskId, sequence, event)
    }

    return sequence
  }

  async range(taskId: string, from = 0): Promise<TaskEvent[]> {
    // Fast path: the live log in Redis (24h). Postgres is the durable fallback for older tasks.
    const items = await this.redis.lrange(this.key(taskId), from, -1)
    if (items.length > 0) {
      return items.map((item) => JSON.parse(item) as TaskEvent)
    }

    if (isDatabaseEnabled()) {
      const pgEvents = await listEventsFromDb(taskId)
      return from > 0 ? pgEvents.slice(from) : pgEvents
    }

    return []
  }

  async length(taskId: string): Promise<number> {
    const redisLen = await this.redis.llen(this.key(taskId))
    if (redisLen > 0) return redisLen
    if (isDatabaseEnabled()) {
      const pgEvents = await listEventsFromDb(taskId)
      return pgEvents.length
    }
    return 0
  }

  async clear(taskId: string): Promise<void> {
    await this.redis.del(this.key(taskId))
    if (isDatabaseEnabled()) {
      await clearEventsInDb(taskId)
    }
  }
}
