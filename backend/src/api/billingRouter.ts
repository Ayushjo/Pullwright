import express, { Router } from "express"
import { z } from "zod"
import logger from "../logger.js"
import { requireAuth } from "./auth.js"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import {
  KEY_PROVIDERS,
  createCheckout,
  createPortalLink,
  deleteKey,
  getEntitlement,
  handleWebhook,
  syncCheckout,
  listKeys,
  saveKey,
  validateKey,
  verifyWebhook,
  PACK,
  type KeyProvider,
} from "../billing/index.js"
import { creditSummary, ledgerHistory } from "../billing/credits.js"
import { claimTrial, trialStatus } from "../billing/trial.js"
import { track } from "../analytics/track.js"

const Checkout = z.object({ kind: z.enum(["pro", "pack"]).default("pro") })

const SaveKey = z.object({
  provider: z.enum(["openai", "openrouter"]),
  key: z.string().trim().min(20).max(300),
  model: z.string().trim().max(100).optional(),
})

/** Authenticated billing + BYOK endpoints (mounted under /api). */
export function createBillingRouter() {
  const router = Router()
  router.use(requireAuth)
  const needUser = (req: express.Request, res: express.Response) => {
    if (!isDatabaseEnabled() || !req.session?.userId) {
      res.status(401).json({ error: "Sign in again" })
      return null
    }
    return req.session.userId
  }

  router.get("/billing", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const [ent, keys, sub] = await Promise.all([
      getEntitlement(userId),
      listKeys(userId),
      getPrisma().subscription.findUnique({ where: { userId }, include: { plan: true } }),
    ])
    res.json({
      entitlement: ent,
      keys,
      subscription: sub && { tier: sub.plan.tier, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd },
      paymentsEnabled: Boolean(process.env.DODO_API_KEY && process.env.DODO_PRO_PRODUCT_ID),
      packEnabled: Boolean(process.env.DODO_API_KEY && PACK.productId()),
    })
  })

  // Balance, what's held back by running tasks, the next expiry, recent ledger rows, and the trial offer.
  router.get("/credits", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const [summary, history, trial] = await Promise.all([creditSummary(userId), ledgerHistory(userId, 30), trialStatus(userId)])
    res.json({
      summary,
      history,
      trial,
      pack: { enabled: Boolean(process.env.DODO_API_KEY && PACK.productId()), priceUsd: Number(process.env.PACK_PRICE_USD ?? 5), creditUsd: PACK.creditUsd, validDays: PACK.validDays },
    })
  })

  router.post("/credits/trial", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const r = await claimTrial(userId, req.session?.accessToken)
    track(r.ok ? "trial_claimed" : "trial_refused", { userId, req, props: r.ok ? { usd: r.usd } : { code: r.code } })
    if (!r.ok) return res.status(r.code === "sold_out_today" ? 429 : 409).json({ error: r.error, code: r.code })
    res.json({ ...r, summary: await creditSummary(userId) })
  })

  router.post("/billing/checkout", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    try {
      const user = await getPrisma().user.findUniqueOrThrow({ where: { id: userId } })
      const { kind } = Checkout.parse(req.body ?? {})
      const url = await createCheckout({ id: user.id, login: user.login, email: user.email, name: user.name }, kind)
      track("checkout_started", { userId, req, props: { kind } })
      res.json({ url })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  // The return page after checkout: confirm with Dodo directly instead of waiting for the webhook.
  router.post("/billing/sync", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    try {
      res.json(await syncCheckout(userId))
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.post("/billing/portal", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    try {
      res.json({ url: await createPortalLink(userId) })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.post("/keys", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const parsed = SaveKey.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Paste a valid API key" })
    const checked = await validateKey(parsed.data.provider, parsed.data.key)
    if ("error" in checked) return res.status(400).json({ error: checked.error })
    await saveKey(userId, parsed.data.provider, parsed.data.key, parsed.data.model)
    // Tier and limits (e.g. OpenRouter free tier: free requests left today) for the wallet UI.
    res.json({ keys: await listKeys(userId), keyInfo: checked.info })
  })

  router.delete("/keys/:provider", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const provider = String(req.params.provider) as KeyProvider
    if (!KEY_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Unknown provider" })
    await deleteKey(userId, provider)
    res.json({ keys: await listKeys(userId) })
  })

  return router
}

/** Dodo webhook — raw body for signature verification; mount before express.json(). */
export const dodoWebhook = [
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req: express.Request, res: express.Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : ""
    const headers = {
      "webhook-id": req.header("webhook-id"),
      "webhook-timestamp": req.header("webhook-timestamp"),
      "webhook-signature": req.header("webhook-signature"),
    }
    if (!verifyWebhook(raw, headers)) {
      logger.warn("Rejected Dodo webhook with an invalid signature")
      return res.status(401).json({ error: "invalid signature" })
    }
    try {
      const result = await handleWebhook(headers["webhook-id"]!, JSON.parse(raw))
      res.json({ ok: true, result })
    } catch (err) {
      logger.error(`Dodo webhook failed: ${(err as Error).message}`)
      res.status(500).json({ error: "processing failed" }) // Dodo retries
    }
  },
] as const
