import { Router } from "express"
import rateLimit, { ipKeyGenerator } from "express-rate-limit"
import { z } from "zod"
import { RedisRateStore } from "./redisRateStore.js"
import { identify, queueEvent, requestContext } from "../analytics/track.js"

/** Event names the browser may send; everything else is ignored. Server events are recorded server-side. */
const CLIENT_EVENTS = new Set(["page_view", "cta_click", "outbound_click", "identify", "pricing_toggle", "faq_open", "copy", "form_error"])

const Utm = z.object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(150), term: z.string().max(150), content: z.string().max(150) }).partial()
const Collect = z.object({
  anonId: z.string().uuid(),
  sessionId: z.string().min(4).max(64),
  events: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        path: z.string().max(300).optional(),
        referrer: z.string().max(300).optional(),
        utm: Utm.optional(),
        props: z.record(z.string(), z.unknown()).optional(),
        ts: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(20),
})

/** Keep only a referrer's origin and path (no query strings, which can carry tokens). Same-site referrers are dropped. */
function cleanReferrer(r: string | undefined, host: string | undefined): string | null {
  if (!r) return null
  try {
    const u = new URL(r)
    if (host && u.host === host) return null
    return `${u.host}${u.pathname}`.slice(0, 300)
  } catch {
    return null
  }
}

/** POST /api/t — the browser's events (public; the user comes from the session cookie, never the body). */
export function createAnalyticsRouter() {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
    store: new RedisRateStore("collect"),
    handler: (_req, res) => res.status(204).end(), // never surface errors to the page
  })
  router.post("/t", limiter, async (req, res) => {
    res.status(204).end()
    const parsed = Collect.safeParse(req.body)
    if (!parsed.success) return
    const ctx = requestContext(req)
    if (ctx.bot) return
    const userId = req.session?.userId ?? null
    // Anonymous visitors who ask not to be tracked aren't (signed-in product events still are: they are the service).
    if (!userId && (req.header("dnt") === "1" || req.header("sec-gpc") === "1")) return
    const site = (() => {
      try {
        return new URL(process.env.FRONTEND_URL ?? "http://localhost").host
      } catch {
        return undefined
      }
    })()
    const now = Date.now()
    for (const e of parsed.data.events) {
      if (!CLIENT_EVENTS.has(e.name)) continue
      const props = e.props && JSON.stringify(e.props).length <= 2048 ? e.props : undefined
      queueEvent({
        name: e.name,
        source: "client",
        // Client clocks drift: accept their timestamp only if it is within the last hour.
        ts: e.ts && e.ts <= now && e.ts > now - 3_600_000 ? new Date(e.ts) : new Date(now),
        userId,
        anonId: parsed.data.anonId,
        sessionId: parsed.data.sessionId,
        path: e.path?.split("?")[0] ?? null,
        referrer: cleanReferrer(e.referrer, site),
        ...(e.utm ? { utm: e.utm } : {}),
        country: ctx.country,
        device: ctx.device,
        browser: ctx.browser,
        os: ctx.os,
        ...(props ? { props } : {}),
      })
      if (e.name === "identify" && userId) await identify(parsed.data.anonId, userId).catch(() => {})
    }
  })
  return router
}
