import type { Request } from "express"
import type { Prisma } from "@prisma/client"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import logger from "../logger.js"
import { parseUa } from "./ua.js"

/**
 * First-party product analytics (analytics_events). Events come from the browser (POST /api/t: page
 * views, clicks) and from the server at the moments that matter (signup, task created / finished, PR
 * published, checkout, purchase, limit hit…). Writes are buffered and batched like llm_calls, so
 * tracking never slows a request and never fails one.
 *
 * Privacy: no IP address is stored (country only, from Cloudflare's CF-IPCountry header); the visitor
 * id is a random UUID the browser keeps in localStorage; anonymous visitors who send Do Not Track or
 * Global Privacy Control aren't tracked (see the collect route).
 */
export type EventRow = {
  name: string
  source: "client" | "server"
  ts?: Date
  userId?: string | null
  anonId?: string | null
  sessionId?: string | null
  path?: string | null
  referrer?: string | null
  utm?: { [K in "source" | "medium" | "campaign" | "term" | "content"]?: string | undefined }
  country?: string | null
  device?: string | null
  browser?: string | null
  os?: string | null
  props?: Record<string, unknown>
}

const pending: Prisma.AnalyticsEventCreateManyInput[] = []
let timer: NodeJS.Timeout | null = null
const MAX_BATCH = 200
const FLUSH_MS = 2_000
const cut = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null)

export function queueEvent(e: EventRow): void {
  if (!isDatabaseEnabled()) return
  pending.push({
    name: e.name.slice(0, 64),
    source: e.source,
    ts: e.ts ?? new Date(),
    userId: e.userId ?? null,
    anonId: e.anonId ?? null,
    sessionId: cut(e.sessionId, 64),
    path: cut(e.path, 300),
    referrer: cut(e.referrer, 300),
    utmSource: cut(e.utm?.source, 100),
    utmMedium: cut(e.utm?.medium, 100),
    utmCampaign: cut(e.utm?.campaign, 150),
    utmTerm: cut(e.utm?.term, 150),
    utmContent: cut(e.utm?.content, 150),
    country: cut(e.country, 2),
    device: e.device ?? null,
    browser: e.browser ?? null,
    os: e.os ?? null,
    ...(e.props && Object.keys(e.props).length ? { props: e.props as Prisma.InputJsonValue } : {}),
  })
  if (e.userId) touchUser(e.userId)
  if (pending.length >= MAX_BATCH) void flushEvents()
  else if (!timer) {
    timer = setTimeout(() => void flushEvents(), FLUSH_MS)
    timer.unref()
  }
}

export async function flushEvents(): Promise<number> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  let written = 0
  while (pending.length) {
    const batch = pending.splice(0, MAX_BATCH)
    try {
      written += (await getPrisma().analyticsEvent.createMany({ data: batch })).count
    } catch (err) {
      logger.warn(`analytics: dropped ${batch.length} events (${(err as Error).message.slice(0, 120)})`)
    }
  }
  return written
}

/** Request context the server adds to every event: country (CDN header) and coarse device info. */
export function requestContext(req: Request): { country: string | null; device: string; browser: string; os: string; bot: boolean } {
  const ua = parseUa(req.header("user-agent"))
  const cc = (req.header("cf-ipcountry") ?? "").toUpperCase()
  return { country: /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null, device: ua.device, browser: ua.browser, os: ua.os, bot: ua.bot }
}

/** A server-side event, for a signed-in action (or the request that caused it). */
export function track(name: string, opts: { userId?: string | null; req?: Request; props?: Record<string, unknown> } = {}): void {
  try {
    const ctx = opts.req ? requestContext(opts.req) : null
    queueEvent({ name, source: "server", userId: opts.userId ?? null, ...(ctx ? { country: ctx.country, device: ctx.device, browser: ctx.browser, os: ctx.os } : {}), ...(opts.props ? { props: opts.props } : {}) })
  } catch {
    // tracking must never break the action it describes
  }
}

/** last_seen_at, at most every 10 minutes per user per process. */
const seen = new Map<string, number>()
function touchUser(userId: string) {
  const now = Date.now()
  if ((seen.get(userId) ?? 0) > now - 10 * 60_000) return
  seen.set(userId, now)
  if (seen.size > 50_000) seen.clear()
  void getPrisma().user.update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } }).catch(() => {})
}

/**
 * At sign-in: attach this browser's anonymous history to the account, and record the user's first
 * touch (the earliest anonymous visit: referrer, landing page, UTM tags) if it isn't set yet.
 */
export async function identify(anonId: string, userId: string): Promise<void> {
  if (!isDatabaseEnabled()) return
  await flushEvents()
  const db = getPrisma()
  await db.analyticsEvent.updateMany({ where: { anonId, userId: null }, data: { userId } })
  const user = await db.user.findUnique({ where: { id: userId }, select: { firstTouch: true } })
  if (user?.firstTouch) return
  const first = await db.analyticsEvent.findFirst({ where: { anonId, name: "page_view" }, orderBy: { ts: "asc" } })
  if (!first) return
  const touch = {
    at: first.ts.toISOString(),
    landing: first.path,
    referrer: first.referrer,
    ...(first.utmSource ? { utm: { source: first.utmSource, medium: first.utmMedium, campaign: first.utmCampaign, term: first.utmTerm, content: first.utmContent } } : {}),
    country: first.country,
    device: first.device,
  }
  await db.user.update({ where: { id: userId }, data: { firstTouch: touch } })
}
