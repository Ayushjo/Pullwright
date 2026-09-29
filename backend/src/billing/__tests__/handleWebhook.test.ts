import { describe, it, expect, vi, beforeEach } from "vitest"

// In-memory stand-in for the Prisma tables the webhook touches.
type Row = Record<string, unknown>
const events = new Map<string, Row>()
const subs = new Map<string, Row>()
const plans: Row[] = [
  { id: "plan-free", tier: "free", providerProductId: null },
  { id: "plan-pro", tier: "pro", providerProductId: "prod_pro" },
]
let failNextUpsert = false

const db = {
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
})
