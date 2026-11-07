import { beforeEach, describe, expect, it } from "vitest"
import type { Request } from "express"
import { closeOldDemoPrs, demoIssues, demoPassthrough } from "../demo.js"

const ID = "0b7c2f5e-1d2a-4c3b-9e8f-1a2b3c4d5e6f"
const TASK = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"
const req = (path: string, cookie?: string, session?: object) => ({ path, cookies: cookie ? { pw_demo: cookie } : {}, session }) as unknown as Request

describe("demo access", () => {
  it("lets a demo cookie through only on one task's own routes", () => {
    for (const p of [`/task/${TASK}`, `/task/${TASK}/events`, `/task/${TASK}/stream`, `/task/${TASK}/approve`, `/task/${TASK}/publish`, `/task/${TASK}/message`]) {
      const r = req(p, ID)
      expect(demoPassthrough(r), p).toBe(true)
      expect(r.demoVisitor).toBe(ID)
    }
  })

  it("never opens other routes, needs a well-formed cookie, and defers to a real session", () => {
    expect(demoPassthrough(req("/tasks", ID))).toBe(false)
    expect(demoPassthrough(req("/task", ID))).toBe(false)
    expect(demoPassthrough(req("/wallet", ID))).toBe(false)
    expect(demoPassthrough(req("/admin/pool", ID))).toBe(false)
    expect(demoPassthrough(req(`/task/${TASK}/extend`, ID))).toBe(false)
    expect(demoPassthrough(req(`/task/${TASK}`))).toBe(false)
    expect(demoPassthrough(req(`/task/${TASK}`, "not-a-uuid"))).toBe(false)
    expect(demoPassthrough(req(`/task/${TASK}`, ID, { userId: "u" }))).toBe(false)
  })
})

describe("demo repo", () => {
  beforeEach(() => {
    process.env.DEMO_REPO = "Ayushjo/pullwright-demo"
    process.env.GITHUB_TOKEN = "t"
  })

  it("lists open issues and leaves out pull requests", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([
        { number: 1, title: "Bug", body: "x", html_url: "https://github.com/Ayushjo/pullwright-demo/issues/1" },
        { number: 7, title: "A PR", body: null, html_url: "u", pull_request: {} },
      ]))) as unknown as typeof fetch
    const issues = await demoIssues(fetchImpl)
    expect(issues.map((i) => i.number)).toEqual([1])
  })

  it("closes only day-old pullwright/* PRs and deletes their branches", async () => {
    const now = Date.parse("2026-11-08T12:00:00Z")
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.github.com/repos/Ayushjo/pullwright-demo", "")}`)
      if (!init?.method)
        return new Response(JSON.stringify([
          { number: 3, created_at: "2026-11-07T08:00:00Z", head: { ref: "pullwright/issue-1-abc" } }, // 28 h old
          { number: 4, created_at: "2026-11-08T09:00:00Z", head: { ref: "pullwright/issue-2-def" } }, // 3 h old
          { number: 5, created_at: "2026-11-01T09:00:00Z", head: { ref: "someone/feature" } }, // not ours
        ]))
      return new Response("{}")
    }) as unknown as typeof fetch
    expect(await closeOldDemoPrs(now, fetchImpl)).toBe(1)
    expect(calls).toEqual(["GET /pulls?state=open&per_page=50", "PATCH /pulls/3", "DELETE /git/refs/heads/pullwright/issue-1-abc"])
  })
})
