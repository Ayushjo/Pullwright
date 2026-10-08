import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

// In-memory stand-in for the Prisma tables the webhook touches.
type Row = Record<string, unknown>
const events = new Map<string, Row>()
const subs = new Map<string, Row>()
const plans: Row[] = [
  { id: "plan-free", tier: "free", providerProductId: null },
  { id: "plan-pro", tier: "pro", providerProductId: "prod_pro" },
]
let failNextUpsert = false
const credits: Row[] = []
process.env.DODO_PACK_PRODUCT_ID = "prod_pack"

const db = {
  user: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "u1" ? { id: "u1" } : null) },
  creditEntry: {
    create: async ({ data }: { data: Row }) => {
      if (credits.some((c) => c.externalRef === data.externalRef)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" })
      credits.push({ ...data })
    },
  },
  paymentEvent: {
    create: async ({ data }: { data: Row }) => {
      if (events.has(data.eventId as string)) throw new Error("unique violation")
      events.set(data.eventId as string, { ...data })
    },
    findUnique: async ({ where }: { where: { eventId: string } }) => events.get(where.eventId) ?? null,
    update: async ({ where, data }: { where: { eventId: string }; data: Row }) => {
      events.set(where.eventId, { ...events.get(where.eventId), ...data })
    },
  },
  plan: {
    findFirst: async ({ where }: { where: Row }) => plans.find((p) => p.providerProductId === where.providerProductId) ?? null,
    findUnique: async ({ where }: { where: Row }) => plans.find((p) => p.tier === where.tier) ?? null,
  },
  subscription: {
    findFirst: async ({ where }: { where: Row }) => [...subs.values()].find((s) => s.providerCustomerId === where.providerCustomerId) ?? null,
    findUnique: async ({ where }: { where: Row }) =>
      [...subs.values()].find((s) => s.providerSubscriptionId === where.providerSubscriptionId) ?? null,
    upsert: async ({ where, create, update }: { where: { userId: string }; create: Row; update: Row }) => {
      if (failNextUpsert) {
        failNextUpsert = false
        throw new Error("db down")
      }
      subs.set(where.userId, subs.has(where.userId) ? { ...subs.get(where.userId), ...update } : { ...create })
    },
  },
}
vi.mock("../../db/prisma.js", () => ({ getPrisma: () => db, isDatabaseEnabled: () => true }))

const { handleWebhook } = await import("../index.js")
const ev = (product_id?: string) => ({
  type: "subscription.active",
  data: { subscription_id: "sub_1", ...(product_id ? { product_id } : {}), metadata: { user_id: "u1" } },
})

beforeEach(() => {
  events.clear()
  subs.clear()
  credits.length = 0
})

describe("Dodo webhook processing", () => {
  it("grants the plan mapped to the product", async () => {
    expect(await handleWebhook("e1", ev("prod_pro"))).toBe("processed")
    expect(subs.get("u1")?.planId).toBe("plan-pro")
  })

  it("never grants Pro for an unknown product (e.g. a credit pack)", async () => {
    expect(await handleWebhook("e2", ev("prod_pack_5usd"))).toBe("ignored")
    expect(subs.has("u1")).toBe(false)
    expect(events.get("e2")?.error).toMatch(/unknown product/)
  })

  it("reprocesses a retried event whose first attempt failed", async () => {
    failNextUpsert = true
    await expect(handleWebhook("e3", ev("prod_pro"))).rejects.toThrow(/db down/)
    expect(events.get("e3")?.error).toMatch(/^failed:/)
    expect(await handleWebhook("e3", ev("prod_pro"))).toBe("processed") // Dodo's retry
    expect(subs.get("u1")?.planId).toBe("plan-pro")
  })

  it("treats a successfully processed event as a duplicate", async () => {
    await handleWebhook("e4", ev("prod_pro"))
    expect(await handleWebhook("e4", ev("prod_pro"))).toBe("duplicate")
  })

  it("keeps the existing plan when a later event has no product", async () => {
    await handleWebhook("e5", ev("prod_pro"))
    expect(await handleWebhook("e6", { type: "subscription.renewed", data: { subscription_id: "sub_1" } })).toBe("processed")
    expect(subs.get("u1")?.planId).toBe("plan-pro")
  })

  it("identifies the user by the linked customer when a subscription event has no metadata", async () => {
    await handleWebhook("e7", { type: "subscription.active", data: { subscription_id: "sub_1", product_id: "prod_pro", customer: { customer_id: "cus_1" }, metadata: { user_id: "u1" } } })
    expect(await handleWebhook("e8", { type: "subscription.cancelled", data: { subscription_id: "sub_2", customer: { customer_id: "cus_1" } } })).toBe("processed")
    expect(subs.get("u1")?.status).toBe("canceled")
    expect(await handleWebhook("e9", { type: "subscription.active", data: { subscription_id: "sub_3", product_id: "prod_pro", customer: { customer_id: "cus_unknown" } } })).toBe("ignored")
  })

  it("a credit-pack payment credits once, even when Dodo delivers it again under a new event id", async () => {
    const pay = { type: "payment.succeeded", data: { payment_id: "pay_1", status: "succeeded", product_cart: [{ product_id: "prod_pack", quantity: 1 }], metadata: { user_id: "u1" } } }
    expect(await handleWebhook("p1", pay as never)).toBe("processed")
    expect(credits).toHaveLength(1)
    expect(credits[0]).toMatchObject({ userId: "u1", kind: "purchase", amountMicros: 4_250_000n, externalRef: "pay:pay_1" })
    expect(await handleWebhook("p1-retry-new-id", pay as never)).toBe("ignored") // same payment, different webhook id
    expect(credits).toHaveLength(1)
    expect(subs.has("u1")).toBe(false) // a pack never creates or changes a subscription
  })

  it("ignores payments that aren't credit packs or have no known user", async () => {
    expect(await handleWebhook("p2", { type: "payment.succeeded", data: { payment_id: "pay_2", status: "succeeded", product_cart: [{ product_id: "prod_other", quantity: 1 }], metadata: { user_id: "u1" } } } as never)).toBe("ignored")
    expect(await handleWebhook("p3", { type: "payment.succeeded", data: { payment_id: "pay_3", status: "succeeded", product_cart: [{ product_id: "prod_pack", quantity: 1 }], metadata: { user_id: "nobody" } } } as never)).toBe("ignored")
    expect(credits).toHaveLength(0)
  })
})

