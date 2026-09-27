import { describe, expect, it, vi } from "vitest"

vi.mock("../store.js", () => ({ taskStore: {}, TERMINAL: [] }))
const { mergeChecklist } = await import("../pipeline.js")

const approved = [
  { title: "Add webhook notifier service" },
  { title: "Persist webhook settings in Redis and add API endpoints" },
  { title: "Call notifier from orchestrator on task_complete" },
  { title: "Add Webhook card UI to Dashboard" },
]

describe("checklist merge", () => {
  it("keeps approved steps when the model collapses the plan", () => {
    const out = mergeChecklist(approved, undefined, [
      { title: "Add webhook notifier service", status: "completed" },
      { title: "Add tests for signPayload and retry", status: "in_progress" },
    ])
    expect(out.slice(0, 4).map((s) => s.title)).toEqual(approved.map((s) => s.title))
    expect(out[0]!.status).toBe("completed")
    expect(out.slice(1, 4).every((s) => s.status === "pending")).toBe(true)
    expect(out[4]).toEqual({ title: "Add tests for signPayload and retry", status: "in_progress" })
  })

  it("matches by position when the model rewords every step", () => {
    const out = mergeChecklist(approved, undefined, approved.map((_, i) => ({ title: `step ${i}`, status: i < 2 ? "completed" : "pending" })))
    expect(out.map((s) => s.status)).toEqual(["completed", "completed", "pending", "pending"])
    expect(out).toHaveLength(4)
  })

  it("keeps earlier statuses for steps the update doesn't mention", () => {
    const prev = mergeChecklist(approved, undefined, [{ title: "Add webhook notifier service", status: "completed" }])
    const next = mergeChecklist(approved, prev, [{ title: "Webhook card UI on the Dashboard", status: "in_progress" }])
    expect(next.map((s) => s.status)).toEqual(["completed", "pending", "pending", "in_progress"])
  })
})
