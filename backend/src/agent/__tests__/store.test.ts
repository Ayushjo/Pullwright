import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import { Redis } from "ioredis"

/** Real Redis (db 14): the CAS and lock scripts are exercised for real. Skipped without Redis. */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/14"
vi.mock("../../config/redis.js", () => ({ createRedisClient: () => new Redis(REDIS_URL, { maxRetriesPerRequest: 1 }) }))

const { taskStore } = await import("../store.js")
type TaskState = Parameters<typeof taskStore.put>[0]

let redis: Redis
let available = true
beforeAll(async () => {
  redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  await redis.connect().catch(() => (available = false))
})
afterAll(async () => {
  await redis.quit().catch(() => {})
})
beforeEach(async () => {
  if (available) await redis.flushdb()
})

const task = (status: TaskState["status"]): TaskState =>
  ({
    taskId: "t1", issueUrl: "u", owner: "o", repo: "r", issueNumber: 1, title: "", body: "", comments: [],
    status, options: { autoApprove: false, autoPublish: false, draft: true }, rejectedFiles: [], checkpoints: [],
    costUsd: 0, llmCalls: 0, toolCalls: 0, createdAt: "", updatedAt: "",
  }) as TaskState

describe("taskStore.transition", () => {
  it("applies the change only from an allowed status", async (ctx) => {
    if (!available) ctx.skip()
    await taskStore.put(task("awaiting_approval"))
    const next = await taskStore.transition("t1", ["awaiting_approval"], (s) => ({ ...s, status: "running" }))
    expect(next?.status).toBe("running")
    expect(await taskStore.transition("t1", ["awaiting_approval"], (s) => ({ ...s, status: "running" }))).toBeNull()
  })

  it("lets exactly one of many concurrent approvals win (double-click)", async (ctx) => {
    if (!available) ctx.skip()
    await taskStore.put(task("awaiting_approval"))
    const results = await Promise.all(
      Array.from({ length: 10 }, () => taskStore.transition("t1", ["awaiting_approval"], (s) => ({ ...s, status: "running" }))),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await taskStore.get("t1"))?.status).toBe("running")
  })
})

describe("stage lock", () => {
  it("is exclusive, renewable only by its owner, and released only by its owner", async (ctx) => {
    if (!available) ctx.skip()
    expect(await taskStore.acquireLock("t1", "w1:a", 5000)).toBe(true)
    expect(await taskStore.acquireLock("t1", "w2:b", 5000)).toBe(false)
    expect(await taskStore.renewLock("t1", "w2:b", 5000)).toBe(false)
    expect(await taskStore.renewLock("t1", "w1:a", 5000)).toBe(true)
    await taskStore.releaseLock("t1", "w2:b") // not the owner: no effect
    expect(await taskStore.isLocked("t1")).toBe(true)
    await taskStore.releaseLock("t1", "w1:a")
    expect(await taskStore.isLocked("t1")).toBe(false)
  })
})
