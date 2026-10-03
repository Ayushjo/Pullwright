import { Redis } from "ioredis"
import type { TaskMetricsSnapshot } from "../events/types.js"
import { createRedisClient } from "../config/redis.js"

export type TaskRegistryEntry = {
  taskId: string
  issueUrl: string
  issueTitle: string
  issueNumber: number
  status:
    | "queued" | "running" | "done" | "failed"
    | "preparing" | "planning" | "awaiting_approval" | "needs_input" | "validating"
    | "ready" | "needs_review" | "parked" | "publishing" | "published" | "cancelled"
  createdAt: string
  updatedAt: string
  prUrl?: string
}

export class TaskRegistry {
  private redis: Redis
  private INDEX_KEY = "tasks:index"
  private TTL = 60 * 60 * 24 * 7 // 7 days

  constructor() {
    this.redis = createRedisClient()
  }

  private taskKey(taskId: string) {
    return `task:${taskId}`
  }

  private metricsKey(taskId: string) {
    return `metrics:${taskId}`
  }

  async register(entry: TaskRegistryEntry): Promise<void> {
    await this.redis.set(this.taskKey(entry.taskId), JSON.stringify(entry), "EX", this.TTL)
    await this.redis.zadd(this.INDEX_KEY, Date.now(), entry.taskId)
  }

  /** Create or merge — used when a task may fail before the orchestrator registers it. */
  async registerOrUpdate(taskId: string, patch: Partial<TaskRegistryEntry> & { issueUrl: string }): Promise<void> {
    const existing = await this.get(taskId)
    if (existing) {
      await this.update(taskId, patch)
      return
    }
    const now = new Date().toISOString()
    const entry: TaskRegistryEntry = {
      taskId,
      issueUrl: patch.issueUrl,
      issueTitle: patch.issueTitle ?? `Issue #${patch.issueNumber ?? 0}`,
      issueNumber: patch.issueNumber ?? 0,
      status: patch.status ?? "queued",
      createdAt: patch.createdAt ?? now,
      updatedAt: now,
    }
    if (patch.prUrl) entry.prUrl = patch.prUrl
    await this.register(entry)
  }

  async update(taskId: string, patch: Partial<TaskRegistryEntry>): Promise<void> {
    const existing = await this.get(taskId)
    if (!existing) return
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    await this.redis.set(this.taskKey(taskId), JSON.stringify(updated), "EX", this.TTL)
  }

  async get(taskId: string): Promise<TaskRegistryEntry | null> {
    const data = await this.redis.get(this.taskKey(taskId))
    return data ? JSON.parse(data) as TaskRegistryEntry : null
  }

  async list(limit = 50): Promise<TaskRegistryEntry[]> {
    const ids = await this.redis.zrevrange(this.INDEX_KEY, 0, limit - 1)
    if (ids.length === 0) return []
    // One round trip for all entries (Redis may be remote).
    const raw = await this.redis.mget(ids.map((id) => this.taskKey(id)))
    return raw.filter((r): r is string => Boolean(r)).map((r) => JSON.parse(r) as TaskRegistryEntry)
  }

  async saveMetrics(taskId: string, metrics: TaskMetricsSnapshot): Promise<void> {
    await this.redis.set(this.metricsKey(taskId), JSON.stringify(metrics), "EX", this.TTL)
  }

  async getMetrics(taskId: string): Promise<TaskMetricsSnapshot | null> {
    const data = await this.redis.get(this.metricsKey(taskId))
    return data ? JSON.parse(data) as TaskMetricsSnapshot : null
  }
}
