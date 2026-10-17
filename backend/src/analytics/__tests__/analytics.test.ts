import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import express from "express"
import type { AddressInfo } from "node:net"
import { MemoryStore } from "express-rate-limit"
import { parseUa } from "../ua.js"

const queued: Record<string, unknown>[] = []
const identified: [string, string][] = []
vi.mock("../track.js", async (orig) => ({
  ...(await orig<typeof import("../track.js")>()),
  queueEvent: (e: Record<string, unknown>) => void queued.push(e),
  identify: async (a: string, u: string) => void identified.push([a, u]),
}))
vi.mock("../../api/redisRateStore.js", () => ({ RedisRateStore: function () { return new MemoryStore() } }))

const { createAnalyticsRouter } = await import("../../api/analyticsRouter.js")

let session: { userId?: string } | undefined
const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  ;(req as unknown as { session?: unknown }).session = session
  next()
})
app.use("/api", createAnalyticsRouter())
const server = app.listen(0)
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/t`
afterAll(() => void server.close())

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
const anonId = "3a38776d-6b2f-4c9b-9d00-20c8618e8279"
const send = (events: unknown[], headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": CHROME, "cf-ipcountry": "IN", ...headers }, body: JSON.stringify({ anonId, sessionId: "s-123456", events }) })
const settle = () => new Promise((r) => setTimeout(r, 30))

beforeEach(() => {
  queued.length = 0
  identified.length = 0
  session = undefined
  process.env.FRONTEND_URL = "https://pullwright.iayush.com"
})

describe("user-agent parsing", () => {
  it("finds device, browser and OS, and flags bots", () => {
    expect(parseUa(CHROME)).toMatchObject({ device: "desktop", browser: "Chrome", os: "macOS", bot: false })
    expect(parseUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toMatchObject({ device: "mobile", browser: "Safari", os: "iOS" })
    expect(parseUa("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)").bot).toBe(true)
    expect(parseUa("").bot).toBe(true)
  })
})

describe("POST /api/t (collect)", () => {
  it("records allowed events with server-side context; strips query strings and same-site referrers", async () => {
    const r = await send([
      { name: "page_view", path: "/pricing?token=secret", referrer: "https://news.ycombinator.com/item?id=1", utm: { source: "hn", medium: "social" } },
      { name: "page_view", path: "/", referrer: "https://pullwright.iayush.com/pricing" },
      { name: "drop_table_users", path: "/" },
    ])
    expect(r.status).toBe(204)
    await settle()
    expect(queued).toHaveLength(2) // unknown event names are ignored
    expect(queued[0]).toMatchObject({ name: "page_view", source: "client", anonId, path: "/pricing", referrer: "news.ycombinator.com/item", utm: { source: "hn", medium: "social" }, country: "IN", device: "desktop", browser: "Chrome", userId: null })
    expect(queued[1]!.referrer).toBeNull()
  })

  it("ignores bots, and anonymous visitors who send Do Not Track or Global Privacy Control", async () => {
    await send([{ name: "page_view", path: "/" }], { "user-agent": "Googlebot/2.1" })
    await send([{ name: "page_view", path: "/" }], { dnt: "1" })
    await send([{ name: "page_view", path: "/" }], { "sec-gpc": "1" })
    await settle()
    expect(queued).toHaveLength(0)
  })

  it("takes the user from the session (never the body) and links the visitor on identify", async () => {
    session = { userId: "8a6497f3-6f79-438d-a9c8-85cff270e3d6" }
    await send([{ name: "identify", path: "/dashboard", props: { userId: "someone-else" } }], { dnt: "1" })
    await settle()
    expect(queued[0]).toMatchObject({ name: "identify", userId: "8a6497f3-6f79-438d-a9c8-85cff270e3d6" })
    expect(identified).toEqual([[anonId, "8a6497f3-6f79-438d-a9c8-85cff270e3d6"]])
  })

  it("rejects malformed batches quietly (always 204, nothing recorded)", async () => {
    const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": CHROME }, body: JSON.stringify({ anonId: "not-a-uuid", sessionId: "x", events: [] }) })
    expect(bad.status).toBe(204)
    await settle()
    expect(queued).toHaveLength(0)
  })
})
