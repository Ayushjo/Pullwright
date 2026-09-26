import { EventEmitter } from "events"
import type { Redis } from "ioredis"
import type { TaskEvent } from "./types.js"
import { timestamp } from "./types.js"
import type { EventLog } from "./eventLog.js"
import { createRedisClient } from "../config/redis.js"
import { redact } from "../agent/git.js"

/**
 * Task event fan-out. Events are appended to the durable log (Redis list + Postgres)
 * and published on a Redis channel, so the API process can stream events produced by a
 * worker running anywhere (e.g. the EC2 sandbox host). Secrets are masked before anything
 * is persisted or streamed (OpenHands EventStream pattern).
 */
export class EventBus {
  private emitters = new Map<string, EventEmitter>()
  private pub: Redis
  private sub: Redis | null = null

  constructor(private eventLog: EventLog) {
    this.pub = createRedisClient()
  }

  private channel(taskId: string) {
    return `pw:events:${taskId}`
  }

  async emit(taskId: string, event: TaskEvent): Promise<void> {
    const masked = JSON.parse(redact(JSON.stringify({ ...event, timestamp: event.timestamp ?? timestamp() }))) as TaskEvent
    const seq = await this.eventLog.append(taskId, masked)
    await this.pub.publish(this.channel(taskId), JSON.stringify({ seq, event: masked }))
  }

  private ensureSub(): Redis {
    if (this.sub) return this.sub
    this.sub = createRedisClient()
    this.sub.on("message", (channel: string, payload: string) => {
      const taskId = channel.slice("pw:events:".length)
      const em = this.emitters.get(taskId)
      if (!em) return
      try {
        const { seq, event } = JSON.parse(payload) as { seq: number; event: TaskEvent }
        em.emit("event", event, seq)
      } catch {
        /* ignore malformed */
      }
    })
    return this.sub
  }

  subscribe(taskId: string): EventEmitter {
    let em = this.emitters.get(taskId)
    if (!em) {
      em = new EventEmitter()
      em.setMaxListeners(50)
      this.emitters.set(taskId, em)
      void this.ensureSub().subscribe(this.channel(taskId))
    }
    return em
  }

  cleanup(taskId: string): void {
    const em = this.emitters.get(taskId)
    if (!em || em.listenerCount("event") > 0) return
    this.emitters.delete(taskId)
    void this.sub?.unsubscribe(this.channel(taskId))
  }
}

export type { TaskEvent } from "./types.js"
