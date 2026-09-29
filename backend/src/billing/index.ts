import crypto from "crypto"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import { decrypt, encrypt } from "../auth/session.js"
import logger from "../logger.js"

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
  key: { kind: "byok"; provider: KeyProvider } | { kind: "platform" } | null
  reason?: string
}

function monthStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const db = getPrisma()
  const [sub, plans, runsUsed, keys, hosted] = await Promise.all([
    db.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    db.plan.findMany(),
    db.task.count({ where: { userId, createdAt: { gte: monthStart() }, NOT: { status: "cancelled" } } }),
    db.apiKey.findMany({ where: { userId }, select: { provider: true } }),
    db.task.aggregate({
      where: { userId, createdAt: { gte: monthStart() }, options: { path: ["keyKind"], equals: "platform" } },
      _sum: { costUsd: true },
    }),
  ])
  const pro = sub && sub.status === "active" && sub.plan.tier === "pro" ? sub.plan : null
  const plan = pro ?? plans.find((p) => p.tier === "free")
  const tier: Entitlement["tier"] = pro ? "pro" : "free"
  const runsIncluded = plan?.includedTasks ?? (tier === "pro" ? 100 : 10)
  // Free never touches the operator's key, whatever the plan row says.
  const hostedAllowanceUsd = tier === "pro" ? Number(plan?.includedSpendUsd ?? 3) : 0
  const hostedSpentUsd = Number(hosted._sum.costUsd ?? 0)
  const byok = KEY_PROVIDERS.find((p) => keys.some((k) => k.provider === p))

  const base = { tier, runsIncluded, runsUsed, hostedAllowanceUsd, hostedSpentUsd }
  if (runsUsed >= runsIncluded) return { ...base, key: null, reason: `You've used all ${runsIncluded} runs included this month.` }
  if (byok) return { ...base, key: { kind: "byok", provider: byok } }
  if (tier === "pro" && hostedSpentUsd < hostedAllowanceUsd) return { ...base, key: { kind: "platform" } }
  return {
    ...base,
    key: null,
    reason: tier === "pro" ? "Your included model usage for this month is used up — add your own key to keep going." : "Add your OpenAI or OpenRouter API key in Settings (your key, encrypted, never logged) — or upgrade to Pro.",
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
export async function validateKey(provider: KeyProvider, key: string): Promise<string | null> {
  const url = provider === "openai" ? "https://api.openai.com/v1/models" : "https://openrouter.ai/api/v1/auth/key"
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (res.status === 401 || res.status === 403) return "That key was rejected by the provider."
    if (!res.ok) return `The provider returned ${res.status} — try again in a moment.`
    return null
  } catch {
    return "Couldn't reach the provider to verify the key."
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

export async function createCheckout(user: { id: string; login: string; email?: string | null; name?: string | null }) {
  const productId = process.env.DODO_PRO_PRODUCT_ID
  if (!productId) throw new Error("Payments are not configured yet (DODO_PRO_PRODUCT_ID missing).")
  const frontend = process.env.FRONTEND_URL ?? "http://localhost:5173"
  const out = await dodo<{ checkout_url: string; session_id?: string }>("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: user.email ?? `${user.login}@users.noreply.github.com`, name: user.name ?? user.login },
      return_url: `${frontend}/settings?billing=success`,
      metadata: { user_id: user.id, github_login: user.login },
    }),
  })
  return out.checkout_url
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

async function applyEvent(db: ReturnType<typeof getPrisma>, ev: DodoEvent): Promise<{ result: "processed" | "ignored"; note?: string }> {
  const status = STATUS[ev.type]
  if (!status && ev.type !== "subscription.updated") return { result: "ignored" }
  const d = ev.data
  let userId = d.metadata?.user_id
  const existing = d.subscription_id ? await db.subscription.findUnique({ where: { providerSubscriptionId: d.subscription_id } }) : null
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
