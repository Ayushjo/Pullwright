import { describe, expect, it, vi } from "vitest"

const written: { taskId: string; sequence: number }[][] = []
let failFirst = true
const createMany = vi.fn(async ({ data }: { data: { taskId: string; sequence: number }[] }) => {
  if (failFirst) {
    failFirst = false
    throw Object.assign(new Error("Foreign key constraint violated: task_events_task_id_fkey"), { code: "P2003" })
  }
  written.push(data)
  return { count: data.length }
})
vi.mock("../../db/prisma.js", () => ({
  isDatabaseEnabled: () => true,
  getPrisma: () => ({ taskEvent: { createMany }, task: { findMany: async () => [{ id: "user-task" }] } }),
}))

const { queueEventForDb, flushEventsToDb } = await import("../eventRepository.js")

describe("event batches", () => {
  it("keeps a user's events when the batch also holds an operator task's (no task row)", async () => {
    queueEventForDb("user-task", 0, { type: "status", status: "planning" } as never)
    queueEventForDb("operator-task", 0, { type: "status", status: "planning" } as never)
    queueEventForDb("user-task", 1, { type: "status", status: "running" } as never)
    expect(await flushEventsToDb()).toBe(2)
    expect(written[0]!.map((e) => `${e.taskId}#${e.sequence}`)).toEqual(["user-task#0", "user-task#1"])
  })
})
