import { Redis } from "ioredis"
import type { TaskEvent } from "./types.js"
import { createRedisClient } from "../config/redis.js"
import { clearEventsInDb, dropPendingEvents, listEventsFromDb, maxEventSeqInDb, queueEventForDb } from "../repositories/eventRepository.js"
import { isDatabaseEnabled } from "../db/prisma.js"

const LIST_TTL = 60 * 60 * 24 // live copy: 24 h
const SEQ_TTL = 60 * 60 * 24 * 30 // sequence counter outlives the list so seq never restarts

/**
 * Assign the next sequence number and append the event in one step, so sequences have no gaps.
 * KEYS: seq counter, event list, list base (seq of the list's first element).
 * ARGV: event json, list ttl, seq ttl. Returns the event's sequence number.
 */
const APPEND = `
local seq = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
local len = redis.call('RPUSH', KEYS[2], ARGV[1])
if len == 1 then redis.call('SET', KEYS[3], seq, 'EX', ARGV[2]) else redis.call('EXPIRE', KEYS[3], ARGV[2]) end
redis.call('EXPIRE', KEYS[2], ARGV[2])
return seq`

/**
 * Per-task event log. Redis holds the live list (24 h); Postgres is the durable copy, written in
 * batches. Sequence numbers come from a separate counter that is re-seeded from Postgres if it ever
 * expires, so a task that waits days (approval, parked) keeps a monotonic sequence and SSE clients
 * resuming from Last-Event-ID don't drop new events.
 */
export class EventLog {
  private redis: Redis

  constructor() {
    this.redis = createRedisClient()
  }

  private key(taskId: string) {
    return `events:${taskId}`
  }
  private seqKey(taskId: string) {
    return `pw:evseq:${taskId}`
  }
  private baseKey(taskId: string) {
    return `pw:evbase:${taskId}`
  }

  async append(taskId: string, event: TaskEvent): Promise<number> {
    if (!(await this.redis.exists(this.seqKey(taskId)))) {
      // First event, or the counter expired: continue after the highest sequence already stored.
      const last = isDatabaseEnabled() ? await maxEventSeqInDb(taskId) : -1
      await this.redis.set(this.seqKey(taskId), String(last), "EX", SEQ_TTL, "NX")
    }
    const seq = Number(
      await this.redis.eval(APPEND, 3, this.seqKey(taskId), this.key(taskId), this.baseKey(taskId), JSON.stringify(event), LIST_TTL, SEQ_TTL),
    )
    queueEventForDb(taskId, seq, event)
    return seq
  }

  /** Events with sequence ≥ from, contiguous and in order (callers number them from + i). */
  async range(taskId: string, from = 0): Promise<TaskEvent[]> {
    const baseRaw = await this.redis.get(this.baseKey(taskId))
    if (baseRaw !== null) {
      const base = Number(baseRaw)
      const live = (await this.redis.lrange(this.key(taskId), Math.max(0, from - base), -1)).map((i) => JSON.parse(i) as TaskEvent)
      if (from >= base || !isDatabaseEnabled()) return live
      // The live list starts later than requested (it expired once): older part from Postgres.
      return [...(await listEventsFromDb(taskId, from, base)), ...live]
    }
    return isDatabaseEnabled() ? listEventsFromDb(taskId, from) : []
  }

  /** Number of events so far (= next sequence number). */
  async length(taskId: string): Promise<number> {
    const last = await this.redis.get(this.seqKey(taskId))
    if (last !== null) return Number(last) + 1
    return isDatabaseEnabled() ? (await maxEventSeqInDb(taskId)) + 1 : 0
  }

  async clear(taskId: string): Promise<void> {
    dropPendingEvents(taskId)
    await this.redis.del(this.key(taskId), this.seqKey(taskId), this.baseKey(taskId))
    if (isDatabaseEnabled()) {
      await clearEventsInDb(taskId)
    }
  }
}
