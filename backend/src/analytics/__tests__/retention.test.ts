import { beforeEach, describe, expect, it, vi } from "vitest"

const deleteMany = vi.fn(async () => ({ count: 7 }))
vi.mock("../../db/prisma.js", () => ({ isDatabaseEnabled: () => true, getPrisma: () => ({ analyticsEvent: { deleteMany } }) }))

const { pruneAnalytics, retentionCutoff } = await import("../retention.js")

describe("analytics retention", () => {
  beforeEach(() => {
    deleteMany.mockClear()
    delete process.env.ANALYTICS_RETENTION_MONTHS
  })

  it("keeps 13 months by default", () => {
    expect(retentionCutoff(new Date("2026-11-01T10:00:00Z")).toISOString()).toBe("2025-10-01T10:00:00.000Z")
  })

  it("deletes only events older than the cut-off", async () => {
    expect(await pruneAnalytics(new Date("2026-11-01T10:00:00Z"))).toBe(7)
    expect(deleteMany).toHaveBeenCalledWith({ where: { ts: { lt: new Date("2025-10-01T10:00:00.000Z") } } })
  })

  it("can be configured, and 0 turns it off", async () => {
    process.env.ANALYTICS_RETENTION_MONTHS = "6"
    expect(retentionCutoff(new Date("2026-11-01T10:00:00Z")).toISOString()).toBe("2026-05-01T10:00:00.000Z")
    process.env.ANALYTICS_RETENTION_MONTHS = "0"
    expect(await pruneAnalytics()).toBe(0)
    expect(deleteMany).not.toHaveBeenCalled()
  })
})
