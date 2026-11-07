import { randomUUID } from "crypto"
import { Router, type Request, type Response } from "express"
import type { Redis } from "ioredis"
import { createRedisClient } from "../config/redis.js"
import { createTask } from "../agent/service.js"
import { taskStore } from "../agent/store.js"
import type { TaskRegistry } from "../store/taskRegistry.js"
import { demoAvailable, DEMO_OPENAI } from "../billing/freeAllowance.js"
import { track } from "../analytics/track.js"
import logger from "../logger.js"

/**
 * Live demo, no account needed: a visitor picks one of the open issues on our demo repo (DEMO_REPO) and
 * watches the real pipeline run on it: plan, their approval, edits in a sandbox, tests, review, and a
 * draft PR on the demo repo when they publish. Runs on the operator's OpenAI demo pool (DEMO_OPENAI).
 *
 * Who: an anonymous random id in an httpOnly cookie (pw_demo). It only opens that visitor's own demo
 * task routes (demoPassthrough + canAccess); everything else still needs a session.
 * Limits: DEMO_RUNS_PER_DAY per visitor and DEMO_IP_RUNS_PER_DAY per IP (rolling UTC day), one run at a
 * time, and the pool's daily/monthly budget. Issues are only ever from the demo repo.
 */
export const DEMO_COOKIE = "pw_demo"
export const demoRepo = () => process.env.DEMO_REPO ?? ""
const runsPerDay = () => Number(process.env.DEMO_RUNS_PER_DAY ?? 2)
const ipRunsPerDay = () => Number(process.env.DEMO_IP_RUNS_PER_DAY ?? 6)
const isProd = () => process.env.NODE_ENV === "production"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The visitor id from the demo cookie, if well-formed. */
export function demoVisitorId(req: Request): string | undefined {
  const v = req.cookies?.[DEMO_COOKIE] as string | undefined
  return v && UUID.test(v) ? v : undefined
}

// The routes a demo visitor may use, on one task: read it, follow it, and act on it like its owner would.
const DEMO_TASK_ROUTE = /^\/task\/[0-9a-f-]{36}(\/(events|stream|diff|metrics|approve|replan|message|publish|cancel|resume|reject|attachments\/\d+))?\/?$/

/** True when a visitor without a session hits a demo-allowed task route with a demo cookie (sets req.demoVisitor). */
export function demoPassthrough(req: Request): boolean {
  if (req.session) return false
  const id = demoVisitorId(req)
  if (!id || !DEMO_TASK_ROUTE.test(req.path)) return false
  req.demoVisitor = id
  return true
}

type DemoIssue = { number: number; title: string; body: string; url: string }
let cache: { at: number; issues: DemoIssue[] } | null = null

/** Open issues on the demo repo (not PRs), cached for 10 minutes. */
export async function demoIssues(fetchImpl: typeof fetch = fetch): Promise<DemoIssue[]> {
  const repo = demoRepo()
  if (!repo) return []
  if (cache && Date.now() - cache.at < 600_000) return cache.issues
  const token = process.env.GITHUB_TOKEN
  const r = await fetchImpl(`https://api.github.com/repos/${repo}/issues?state=open&per_page=30&sort=created&direction=asc`, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`GitHub ${r.status}`)
  const rows = (await r.json()) as { number: number; title: string; body: string | null; html_url: string; pull_request?: unknown }[]
  const issues = rows.filter((x) => !x.pull_request).map((x) => ({ number: x.number, title: x.title, body: (x.body ?? "").slice(0, 600), url: x.html_url }))
  cache = { at: Date.now(), issues }
  return issues
}

const ACTIVE = ["queued", "preparing", "planning", "awaiting_approval", "needs_input", "running", "validating", "parked", "publishing"]
const dayKey = () => new Date().toISOString().slice(0, 10)
let redis: Redis | null = null
const r = () => (redis ??= createRedisClient())

export function createDemoRouter(taskRegistry: TaskRegistry): Router {
  const router = Router()

  router.get("/", async (req: Request, res: Response) => {
    const id = demoVisitorId(req)
    const [issues, open] = await Promise.all([demoIssues().catch(() => [] as DemoIssue[]), demoAvailable().catch(() => false)])
    const used = id ? Number((await r().get(`demo:runs:${id}:${dayKey()}`)) ?? 0) : 0
    const activeId = id ? await r().get(`demo:active:${id}`) : null
    const active = activeId ? await taskStore.get(activeId) : null
    res.json({
      enabled: Boolean(demoRepo()) && DEMO_OPENAI.enabled(),
      open,
      repo: demoRepo(),
      issues,
      left: Math.max(0, runsPerDay() - used),
      perDay: runsPerDay(),
      ...(active && ACTIVE.includes(active.status) ? { activeTaskId: active.taskId } : {}),
    })
  })

  router.post("/run", async (req: Request, res: Response) => {
    const issueNumber = Number((req.body as { issue?: unknown } | undefined)?.issue)
    if (!demoRepo() || !DEMO_OPENAI.enabled()) return res.status(503).json({ error: "The live demo is off right now.", code: "demo_off" })
    const issue = (await demoIssues().catch(() => [] as DemoIssue[])).find((i) => i.number === issueNumber)
    if (!issue) return res.status(400).json({ error: "Pick one of the demo issues." })
    if (!(await demoAvailable().catch(() => false))) {
      return res.status(503).json({ error: "Today's live demos are used up. Watch a recorded run instead, or come back tomorrow.", code: "demo_full" })
    }

    let id = demoVisitorId(req)
    if (!id) {
      id = randomUUID()
      res.cookie(DEMO_COOKIE, id, { httpOnly: true, secure: isProd(), sameSite: isProd() ? "none" : "lax", maxAge: 7 * 86_400_000, path: "/" })
    }

    // One run at a time per visitor.
    const activeId = await r().get(`demo:active:${id}`)
    const active = activeId ? await taskStore.get(activeId) : null
    if (active && ACTIVE.includes(active.status)) return res.status(409).json({ error: "Your demo run is still going.", code: "demo_active", taskId: active.taskId })

    // Per visitor and per IP, per UTC day; given back if the task can't be created.
    const vKey = `demo:runs:${id}:${dayKey()}`
    const ipKey = `demo:runs:ip:${req.ip ?? "unknown"}:${dayKey()}`
    const v = await r().incr(vKey)
    const ip = await r().incr(ipKey)
    await r().multi().expire(vKey, 172_800).expire(ipKey, 172_800).exec()
    const refund = () => r().multi().decr(vKey).decr(ipKey).exec()
    if (v > runsPerDay() || ip > ipRunsPerDay()) {
      await refund()
      return res.status(429).json({ error: `That's ${runsPerDay()} live demos for today. Watch a recorded run, or sign in to run Pullwright on your own issues.`, code: "demo_daily" })
    }

    try {
      const s = await createTask(
        {
          issueUrl: issue.url,
          demoVisitor: id,
          options: {
            autoApprove: false, // the visitor approves the plan: that's the point of the demo
            autoPublish: false,
            draft: true,
            keyKind: "platform",
            fundedBy: "demo",
            capUsd: DEMO_OPENAI.taskCapUsd(),
            queueClass: "free",
          },
        },
        taskRegistry,
      )
      await r().set(`demo:active:${id}`, s.taskId, "EX", 86_400)
      track("demo_started", { req, props: { taskId: s.taskId, issue: issue.number } })
      logger.info(`Demo run ${s.taskId} on ${demoRepo()}#${issue.number}`)
      res.status(201).json({ taskId: s.taskId })
    } catch (err) {
      await refund()
      logger.warn(`demo run failed to start: ${(err as Error).message}`)
      res.status(500).json({ error: "The demo couldn't start. Try again in a minute." })
    }
  })

  return router
}

/** Closes draft PRs the demo opened (branches pullwright/*) once they're a day old, and deletes their branches. */
export async function closeOldDemoPrs(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<number> {
  const repo = demoRepo()
  const token = process.env.GITHUB_TOKEN
  if (!repo || !token) return 0
  const gh = (path: string, init?: RequestInit) =>
    fetchImpl(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15_000) })
  const res = await gh(`/pulls?state=open&per_page=50`)
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const prs = (await res.json()) as { number: number; created_at: string; head: { ref: string } }[]
  let closed = 0
  for (const pr of prs) {
    if (!pr.head.ref.startsWith("pullwright/") || now - Date.parse(pr.created_at) < 86_400_000) continue
    await gh(`/pulls/${pr.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }), headers: { "Content-Type": "application/json" } })
    await gh(`/git/refs/heads/${pr.head.ref}`, { method: "DELETE" }).catch(() => null)
    closed++
  }
  return closed
}

export function startDemoPrJanitor(intervalMs = 3_600_000): NodeJS.Timeout {
  const tick = () =>
    closeOldDemoPrs()
      .then((n) => n && logger.info(`demo: closed ${n} day-old demo PRs`))
      .catch((err) => logger.warn(`demo PR cleanup failed: ${(err as Error).message}`))
  setTimeout(tick, 10 * 60_000).unref()
  const t = setInterval(tick, intervalMs)
  t.unref()
  return t
}

