import { loadWallet } from "../wallet/credentials.js"
import { walletCapability } from "../wallet/routing.js"
import crypto from "crypto"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import { decrypt, encrypt } from "../auth/session.js"
import logger from "../logger.js"
import { createRedisClient } from "../config/redis.js"
import type { Redis } from "ioredis"
import { creditSummary, grantCredit, type CreditSummary } from "./credits.js"

/**
 * Plans, entitlements, bring-your-own-key and Dodo Payments.
 *
 *   Free — your own OpenAI / OpenRouter key is required (the platform key is never used), N runs / month.
 *   Pro  — model usage included up to a monthly $ allowance on the platform key; BYOK optional.
 */

export type KeyProvider = "openai" | "openrouter"
export const KEY_PROVIDERS: KeyProvider[] = ["openai", "openrouter"]

export type Entitlement = {
  tier: "free" | "pro"
  runsIncluded: number
  runsUsed: number
  hostedAllowanceUsd: number
  hostedSpentUsd: number
  /** Which key a new task will use, or null when the user must add a key / upgrade. */
  key:
    | { kind: "byok"; provider: KeyProvider }
    | { kind: "platform"; fundedBy: "credits"; capUsd: number; trialOnly: boolean }
    | { kind: "wallet"; allFree: boolean }
    | null
  credits: CreditSummary | null
  reason?: string
}

/** Smallest balance worth starting a task on, and the caps for tasks paid from credits. */
const MIN_CREDIT_TASK_USD = Number(process.env.MIN_CREDIT_TASK_USD ?? 0.02)
const CREDIT_TASK_CAP_USD = Number(process.env.CREDIT_TASK_CAP_USD ?? 0.3)
export const TRIAL_TASK_CAP_USD = Number(process.env.TRIAL_TASK_CAP_USD ?? 0.1)

/**
 * Pro's monthly included usage is a ledger grant for the current billing period, created at most once per
 * period (idempotent by external ref). Called when entitlements are read, so a missed webhook or a
 * subscription that predates the ledger still gets its period's credit.
 */
async function ensureProGrant(userId: string, sub: { id: string; providerSubscriptionId: string | null; currentPeriodEnd: Date | null }, usd: number) {
  if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() <= Date.now() || !(usd > 0)) return
  await grantCredit({
    userId,
    kind: "grant",
    usd,
    externalRef: `pro:${sub.providerSubscriptionId ?? sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`,
    expiresAt: sub.currentPeriodEnd,
    note: "Pro monthly included usage",
  })
}

function monthStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const db = getPrisma()
  const [sub, plans, runsUsed, keys] = await Promise.all([
    db.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    db.plan.findMany(),
    db.task.count({ where: { userId, createdAt: { gte: monthStart() }, NOT: { status: "cancelled" } } }),
    db.apiKey.findMany({ where: { userId }, select: { provider: true } }),
  ])
  const pro = sub && sub.status === "active" && sub.plan.tier === "pro" ? sub.plan : null
  const plan = pro ?? plans.find((p) => p.tier === "free")
  const tier: Entitlement["tier"] = pro ? "pro" : "free"
  const runsIncluded = plan?.includedTasks ?? (tier === "pro" ? 100 : 10)
  const hostedAllowanceUsd = tier === "pro" ? Number(plan?.includedSpendUsd ?? 3) : 0
  if (pro && sub) await ensureProGrant(userId, sub, hostedAllowanceUsd)
  const credits = await creditSummary(userId)
  const hostedSpentUsd = tier === "pro" ? Math.max(0, +(hostedAllowanceUsd - credits.grantRemainingUsd).toFixed(6)) : 0
  const byok = KEY_PROVIDERS.find((p) => keys.some((k) => k.provider === p))

  const base = { tier, runsIncluded, runsUsed, hostedAllowanceUsd, hostedSpentUsd, credits }
  // 1. The wallet: tasks on the user's own keys (free ones first). Daily admission limits apply.
  const wallet = walletCapability(await loadWallet(userId))
  if (wallet.canRun) return { ...base, key: { kind: "wallet", allFree: wallet.allFree } }
  // 2. Credits (Pro's monthly grant, packs, the trial): our models, hard-capped by what's available.
  if (credits.availableUsd >= MIN_CREDIT_TASK_USD) {
    const capUsd = +Math.min(CREDIT_TASK_CAP_USD, credits.availableUsd, credits.trialOnly ? TRIAL_TASK_CAP_USD : Infinity).toFixed(4)
    return { ...base, key: { kind: "platform", fundedBy: "credits", capUsd, trialOnly: credits.trialOnly } }
  }
  // 3. Legacy own OpenAI/OpenRouter key (pre-wallet), still bounded by the monthly run count.
  if (runsUsed >= runsIncluded) return { ...base, key: null, reason: `You've used all ${runsIncluded} runs included this month.` }
  if (byok) return { ...base, key: { kind: "byok", provider: byok } }
  return {
    ...base,
    key: null,
    reason:
      wallet.missing && keys.length
        ? wallet.missing
        : tier === "pro"
          ? "Your included model usage for this month is used up — buy a credit pack or add your own key to keep going."
          : "Add a free Gemini key in your Wallet (2 minutes, no card), try 2 tasks free, or buy credits.",
  }
}

// ── BYOK keys ────────────────────────────────────────────────────────────────

export async function listKeys(userId: string) {
  return getPrisma().apiKey.findMany({
    where: { userId },
    select: { provider: true, last4: true, model: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "asc" },
  })
}

/** Cheap validity check: list models (no tokens spent). */
/** What the provider told us about a key at validation time (OpenRouter reports tier and limits). */
export type KeyInfo = {
  tier: "free" | "paid" | "unknown"
  limitUsd?: number | null
  limitRemainingUsd?: number | null
  freeRequestsToday?: { used: number; limit: number; remaining: number }
}

/** Verifies a key with a free provider call. Returns an error message, or the key's tier/limits. */
export async function validateKey(provider: KeyProvider, key: string): Promise<{ error: string } | { info: KeyInfo }> {
  const url = provider === "openai" ? "https://api.openai.com/v1/models" : "https://openrouter.ai/api/v1/key"
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (res.status === 401 || res.status === 403) return { error: "That key was rejected by the provider." }
    if (!res.ok) return { error: `The provider returned ${res.status} — try again in a moment.` }
    if (provider !== "openrouter") return { info: { tier: "paid" } }
    return { info: openRouterKeyInfo(await res.json().catch(() => null)) }
  } catch {
    return { error: "Couldn't reach the provider to verify the key." }
  }
}

/** Parses OpenRouter's GET /api/v1/key response (is_free_tier, limit, limit_remaining, free_model_daily_requests). */
export function openRouterKeyInfo(body: unknown): KeyInfo {
  const d = (body as { data?: Record<string, unknown> } | null)?.data
  if (!d) return { tier: "unknown" }
  const num = (v: unknown) => (typeof v === "number" ? v : v === null ? null : undefined)
  const free = d.free_model_daily_requests as { used?: number; limit?: number; remaining?: number } | undefined
  const limit = num(d.limit)
  const remaining = num(d.limit_remaining)
  return {
    tier: d.is_free_tier === true ? "free" : d.is_free_tier === false ? "paid" : "unknown",
    ...(limit !== undefined ? { limitUsd: limit } : {}),
    ...(remaining !== undefined ? { limitRemainingUsd: remaining } : {}),
    ...(free && typeof free.limit === "number"
      ? { freeRequestsToday: { used: free.used ?? 0, limit: free.limit, remaining: free.remaining ?? free.limit - (free.used ?? 0) } }
      : {}),
  }
}

export async function saveKey(userId: string, provider: KeyProvider, key: string, model?: string) {
  const data = { encryptedKey: encrypt(key), last4: key.slice(-4), model: model ?? null }
  await getPrisma().apiKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...data },
    update: data,
  })
}

export async function deleteKey(userId: string, provider: KeyProvider) {
  await getPrisma().apiKey.deleteMany({ where: { userId, provider } })
}

/** Worker-side: decrypt the user's key for a task. Never logged, never sent to the client. */
export async function loadKey(userId: string, provider: KeyProvider): Promise<{ key: string; model: string | null } | null> {
  if (!isDatabaseEnabled()) return null
  const row = await getPrisma().apiKey.findUnique({ where: { userId_provider: { userId, provider } } })
  if (!row) return null
  void getPrisma().apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { key: decrypt(row.encryptedKey), model: row.model }
}

// ── Dodo Payments ─────────────────────────────────────────────────────────────

function dodoBase() {
  return process.env.DODO_ENV === "live_mode" ? "https://live.dodopayments.com" : "https://test.dodopayments.com"
}

async function dodo<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.DODO_API_KEY
  if (!key) throw new Error("Payments are not configured yet (DODO_API_KEY missing).")
  const res = await fetch(`${dodoBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  if (!res.ok) {
    logger.error(`Dodo ${path} → ${res.status}: ${text.slice(0, 300)}`)
    throw new Error("The payment provider rejected the request. Please try again later.")
  }
  return JSON.parse(text) as T
}

// The last checkout each user opened, so the return page can confirm it without waiting for a webhook
// (webhooks can't reach a local backend, and in production they may simply arrive late).
let redis: Redis | null = null
const checkoutKey = (userId: string) => `pw:billing:checkout:${userId}`
function billingRedis() {
  return (redis ??= createRedisClient())
}

/** A credit pack: one-time Dodo product → credit after the processor's fee, valid 12 months. */
export const PACK = {
  productId: () => process.env.DODO_PACK_PRODUCT_ID,
  creditUsd: Number(process.env.PACK_CREDIT_USD ?? 4.25),
  validDays: Number(process.env.PACK_VALID_DAYS ?? 365),
}

export async function createCheckout(user: { id: string; login: string; email?: string | null; name?: string | null }, kind: "pro" | "pack" = "pro") {
  const productId = kind === "pack" ? PACK.productId() : process.env.DODO_PRO_PRODUCT_ID
  if (!productId) throw new Error(`Payments are not configured yet (${kind === "pack" ? "DODO_PACK_PRODUCT_ID" : "DODO_PRO_PRODUCT_ID"} missing).`)
  const frontend = process.env.FRONTEND_URL ?? "http://localhost:5173"
  const out = await dodo<{ checkout_url?: string | null; session_id: string }>("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: user.email ?? `${user.login}@users.noreply.github.com`, name: user.name ?? user.login },
      return_url: `${frontend}/settings?billing=success`,
      cancel_url: `${frontend}/pricing`,
      metadata: { user_id: user.id, github_login: user.login, kind },
    }),
  })
  if (!out.checkout_url) throw new Error("The payment provider didn't return a checkout page. Please try again.")
  await billingRedis().set(checkoutKey(user.id), out.session_id, "EX", 24 * 3600)
  return out.checkout_url
}

type DodoSubscription = {
  subscription_id: string
  status: string
  product_id: string
  next_billing_date?: string
  cancel_at_next_billing_date?: boolean
  customer?: { customer_id?: string; email?: string }
  metadata?: Record<string, string>
}

/**
 * Confirm the user's last checkout straight from Dodo (checkout → payment → subscription) and apply it
 * exactly like the matching webhook would. Safe to call repeatedly; the subscription must belong to this
 * user (its metadata, or the checkout we stored for them).
 */
export async function syncCheckout(userId: string): Promise<{ status: string }> {
  const sessionId = await billingRedis().get(checkoutKey(userId))
  if (!sessionId) return { status: "none" }
  const session = await dodo<{ payment_id?: string | null; payment_status?: string | null }>(`/checkouts/${encodeURIComponent(sessionId)}`)
  if (!session.payment_id) return { status: session.payment_status ?? "pending" }
  const payment = await dodo<{ subscription_id?: string | null; status?: string | null; metadata?: Record<string, string>; product_cart?: { product_id: string; quantity: number }[] | null }>(
    `/payments/${encodeURIComponent(session.payment_id)}`,
  )
  if (!payment.subscription_id) {
    // A one-time purchase (credit pack): apply it like the payment.succeeded webhook would.
    if (payment.status !== "succeeded") return { status: payment.status ?? "pending" }
    const owner = payment.metadata?.user_id
    if (owner && owner !== userId) throw new Error("That payment belongs to another account.")
    const out = await applyPayment(getPrisma(), { ...(payment as DodoPayment), payment_id: session.payment_id, metadata: { ...(payment.metadata ?? {}), user_id: userId } })
    return { status: out.result === "processed" ? "credited" : "succeeded" }
  }
  const sub = await dodo<DodoSubscription>(`/subscriptions/${encodeURIComponent(payment.subscription_id)}`)
  const owner = sub.metadata?.user_id ?? payment.metadata?.user_id
  if (owner && owner !== userId) throw new Error("That subscription belongs to another account.")
  if (sub.status === "pending") return { status: "pending" }
  await applyEvent(getPrisma(), {
    type: `subscription.${sub.status}`,
    data: { ...sub, metadata: { ...(sub.metadata ?? {}), user_id: userId } },
  })
  return { status: sub.status }
}

export async function createPortalLink(userId: string) {
  const sub = await getPrisma().subscription.findUnique({ where: { userId } })
  if (!sub?.providerCustomerId) throw new Error("No billing account yet.")
  const frontend = process.env.FRONTEND_URL ?? "http://localhost:5173"
  const out = await dodo<{ link: string }>(
    `/customers/${encodeURIComponent(sub.providerCustomerId)}/customer-portal/session?return_url=${encodeURIComponent(`${frontend}/settings`)}`,
    { method: "POST" },
  )
  return out.link
}

/**
 * Standard Webhooks verification: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the
 * base64 secret after the `whsec_` prefix; header holds space-separated `v1,<sig>` entries.
 */
export function verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret = process.env.DODO_WEBHOOK_SECRET): boolean {
  const id = headers["webhook-id"]
  const ts = headers["webhook-timestamp"]
  const sigHeader = headers["webhook-signature"]
  if (!secret || !id || !ts || !sigHeader) return false
  const age = Math.abs(Date.now() / 1000 - Number(ts))
  if (!Number.isFinite(age) || age > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest()
  return sigHeader.split(" ").some((part) => {
    const [ver, sig] = part.split(",")
    if (ver !== "v1" || !sig) return false
    const given = Buffer.from(sig, "base64")
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
  })
}

type DodoEvent = {
  type: string
  timestamp?: string
  data: {
    subscription_id?: string
    status?: string
    product_id?: string
    next_billing_date?: string
    cancel_at_next_billing_date?: boolean
    customer?: { customer_id?: string; email?: string }
    metadata?: Record<string, string>
  }
}

const STATUS: Record<string, "active" | "past_due" | "canceled" | "unpaid"> = {
  "subscription.active": "active",
  "subscription.renewed": "active",
  "subscription.unpaused": "active",
  "subscription.plan_changed": "active",
  "subscription.past_due": "past_due",
  "subscription.on_hold": "past_due",
  "subscription.paused": "past_due",
  "subscription.failed": "unpaid",
  "subscription.cancelled": "canceled",
  "subscription.expired": "canceled",
}

const PROCESSING = "processing"

/**
 * Idempotent and retry-safe: each webhook-id is processed once (payment_events.event_id is unique).
 * The row is marked "processing" when claimed and cleared on success; if processing throws, the
 * error is stored and the throw makes the route answer 5xx, so Dodo's retry is processed again
 * instead of being dropped as a duplicate.
 */
export async function handleWebhook(eventId: string, ev: DodoEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const db = getPrisma()
  try {
    await db.paymentEvent.create({ data: { eventId, provider: "dodo", eventType: ev.type, payload: ev as unknown as object, error: PROCESSING } })
  } catch {
    const prev = await db.paymentEvent.findUnique({ where: { eventId } })
    const unfinished = prev && (prev.error === PROCESSING || prev.error?.startsWith("failed:"))
    if (!unfinished) return "duplicate"
  }
  try {
    const out = await applyEvent(db, ev)
    await db.paymentEvent.update({ where: { eventId }, data: { error: out.note ?? null, processedAt: new Date() } })
    return out.result
  } catch (err) {
    await db.paymentEvent.update({ where: { eventId }, data: { error: `failed: ${(err as Error).message}`.slice(0, 500) } }).catch(() => {})
    throw err
  }
}

/** Which plan a Dodo product buys: plans.provider_product_id, or DODO_PRO_PRODUCT_ID for Pro. */
async function planForProduct(db: ReturnType<typeof getPrisma>, productId: string | undefined) {
  if (!productId) return null
  const byColumn = await db.plan.findFirst({ where: { providerProductId: productId } })
  if (byColumn) return byColumn
  if (productId === process.env.DODO_PRO_PRODUCT_ID) return db.plan.findUnique({ where: { tier: "pro" } })
  return null
}

type DodoPayment = {
  payment_id: string
  status?: string | null
  subscription_id?: string | null
  product_cart?: { product_id: string; quantity: number }[] | null
  metadata?: Record<string, string>
}

/**
 * A successful one-time payment that bought credit packs → one purchase credit, keyed by the payment id
 * (a webhook retry or the return-page sync after the webhook can't credit twice). Subscription payments
 * and unknown products are ignored here; subscriptions go through applyEvent.
 */
async function applyPayment(db: ReturnType<typeof getPrisma>, p: DodoPayment): Promise<{ result: "processed" | "ignored"; note?: string }> {
  if (p.status && p.status !== "succeeded") return { result: "ignored", note: `payment ${p.status}` }
  if (p.subscription_id) return { result: "ignored", note: "subscription payment" }
  const packId = PACK.productId()
  const packs = (p.product_cart ?? []).filter((i) => packId && i.product_id === packId).reduce((n, i) => n + Math.max(1, i.quantity), 0)
  if (!packs) return { result: "ignored", note: "no credit pack in cart" }
  const userId = p.metadata?.user_id
  if (!userId || !(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) return { result: "ignored", note: "no known user_id in metadata" }
  const res = await grantCredit({
    userId,
    kind: "purchase",
    usd: +(PACK.creditUsd * packs).toFixed(2),
    externalRef: `pay:${p.payment_id}`,
    expiresAt: new Date(Date.now() + PACK.validDays * 86_400_000),
    note: `${packs} credit pack${packs > 1 ? "s" : ""}`,
  })
  return res === "granted" ? { result: "processed" } : { result: "ignored", note: "already credited" }
}

async function applyEvent(db: ReturnType<typeof getPrisma>, ev: DodoEvent): Promise<{ result: "processed" | "ignored"; note?: string }> {
  if (ev.type === "payment.succeeded") return applyPayment(db, ev.data as unknown as DodoPayment)
  const status = STATUS[ev.type]
  if (!status && ev.type !== "subscription.updated") return { result: "ignored" }
  const d = ev.data
  let userId = d.metadata?.user_id
  // Checkout metadata is attached to the payment; if a subscription event arrives without it, the
  // customer we already linked (from an earlier event or a return-page sync) identifies the user.
  const existing =
    (d.subscription_id ? await db.subscription.findUnique({ where: { providerSubscriptionId: d.subscription_id } }) : null) ??
    (d.customer?.customer_id ? await db.subscription.findFirst({ where: { providerCustomerId: d.customer.customer_id } }) : null)
  if (!userId) userId = existing?.userId
  if (!userId) return { result: "ignored", note: "no user_id in metadata" }
  // The product decides the plan. An unknown product grants nothing (a credit pack must never
  // become Pro); an event without a product keeps the plan the subscription already has.
  const plan = await planForProduct(db, d.product_id)
  if (d.product_id && !plan) return { result: "ignored", note: `unknown product ${d.product_id}` }
  const planId = plan?.id ?? existing?.planId
  if (!planId) return { result: "ignored", note: "no product and no existing subscription" }
  const fields = {
    planId,
    provider: "dodo",
    providerSubscriptionId: d.subscription_id ?? null,
    providerCustomerId: d.customer?.customer_id ?? null,
    providerStatus: d.status ?? ev.type,
    ...(status ? { status } : {}),
    cancelAtPeriodEnd: Boolean(d.cancel_at_next_billing_date),
    ...(d.next_billing_date ? { currentPeriodEnd: new Date(d.next_billing_date) } : {}),
  }
  await db.subscription.upsert({ where: { userId }, create: { userId, ...fields }, update: fields })
  logger.info(`Billing: ${ev.type} for user ${userId}`)
  return { result: "processed" }
}
