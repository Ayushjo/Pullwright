import { describe, it, expect, vi, beforeEach } from "vitest"

const spent = new Map<string, number>()
const recordTaskSpend = vi.fn(async () => {})
const createTaskInDb = vi.fn(async () => {})
const stored: Record<string, unknown>[] = []

vi.mock("bullmq", () => ({ Queue: class { add = vi.fn() }, Worker: class {}, DelayedError: class extends Error {} }))
vi.mock("../../config/redis.js", () => ({ createRedisClient: () => ({ incr: async () => 1, expire: async () => 1 }), getRedisOptions: () => ({}) }))
vi.mock("../../billing/credits.js", () => ({ recordTaskSpend }))
vi.mock("../../repositories/taskRepository.js", () => ({ createTaskInDb, saveMetricsToDb: async () => {}, syncTaskStateToDb: async () => {} }))
vi.mock("../../repositories/usageRepository.js", () => ({ recordTaskUsage: async () => {} }))
vi.mock("../spend.js", () => ({ getSpendLedger: () => ({ taskSpent: (id: string) => spent.get(id) ?? 0, taskCapUsd: 0.15 }) }))
vi.mock("../pipeline.js", () => ({ Pipeline: class {}, metricsOf: () => ({ costUsd: 0, llmCalls: 0 }) }))
vi.mock("../sandbox.js", () => ({ Sandbox: class {}, WORKER_ID: "w" }))
vi.mock("../store.js", () => ({
  TERMINAL: ["published", "failed", "cancelled"],
  taskStore: { put: async (s: Record<string, unknown>) => void stored.push(s), putToken: async () => {}, get: async () => null },
}))

const { makeStatusSink, createTask } = await import("../service.js")
const registry = { registerOrUpdate: async () => {}, saveMetrics: async () => {}, register: async () => {} } as never
const task = (options: Record<string, unknown>) => ({ taskId: "t1", userId: "u1", status: "running", issueUrl: "x", issueNumber: 1, title: "t", options }) as never

beforeEach(() => {
  spent.clear()
  recordTaskSpend.mockClear()
  stored.length = 0
})

describe("credit debits", () => {
  it("debits a credit-funded task's spend", async () => {
    spent.set("t1", 0.042)
    await makeStatusSink(registry)(task({ keyKind: "platform", fundedBy: "credits", capUsd: 0.3 }))
    expect(recordTaskSpend).toHaveBeenCalledWith("u1", "t1", 0.042)
  })

  it("never debits wallet, own-key or operator tasks, even on our platform lanes", async () => {
    spent.set("t1", 0.05)
    for (const o of [{ keyKind: "wallet" }, { keyKind: "byok", keyProvider: "openai" }, { keyKind: "platform" }]) await makeStatusSink(registry)(task(o))
    expect(recordTaskSpend).not.toHaveBeenCalled()
  })

  it("createTask keeps the funding, cap and consent the route chose (and stores them with the row)", async () => {
    await createTask(
      { issueUrl: "https://github.com/o/r/issues/3", userId: "u1", options: { keyKind: "platform", fundedBy: "credits", capUsd: 0.1, allowTraining: true } },
      registry,
    )
    expect(stored[0]!.options).toMatchObject({ fundedBy: "credits", capUsd: 0.1, allowTraining: true })
    expect(createTaskInDb).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ fundedBy: "credits", capUsd: 0.1 }) }))
  })
})
