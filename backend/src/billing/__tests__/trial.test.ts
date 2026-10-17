import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

type Entry = { userId: string; kind: string; amountMicros: bigint; externalRef: string; createdAt: Date; expiresAt: Date }
const entries: Entry[] = []
const users = new Map<string, { githubId: bigint; githubCreatedAt: Date | null }>()
let clock = new Date("2026-10-08T12:00:00Z")

const creditEntry = {
  findUnique: async ({ where }: { where: { externalRef: string } }) => entries.find((e) => e.externalRef === where.externalRef) ?? null,
  count: async ({ where }: { where: { kind: string; createdAt: { gte: Date } } }) => entries.filter((e) => e.kind === where.kind && e.createdAt >= where.createdAt.gte).length,
  create: async ({ data }: { data: Omit<Entry, "createdAt"> }) => {
    if (entries.some((e) => e.externalRef === data.externalRef)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" })
    entries.push({ ...data, createdAt: clock })
  },
}
const db = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: { githubCreatedAt: Date } }) => void Object.assign(users.get(where.id)!, data),
  },
  creditEntry,
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ creditEntry, $executeRaw: async () => 0 }),
}
vi.mock("../../db/prisma.js", () => ({ getPrisma: () => db }))

const { claimTrial } = await import("../trial.js")
const old = async () => new Date("2020-01-01")

beforeEach(() => {
  process.env.TRIAL_ENABLED = "1" // .env turns the trial off now that the monthly allowance replaces it
  entries.length = 0
  users.clear()
  clock = new Date("2026-10-08T12:00:00Z")
  for (let i = 1; i <= 6; i++) users.set(`u${i}`, { githubId: BigInt(i), githubCreatedAt: null })
})

describe("free trial", () => {
  it("grants $0.20 once per GitHub account, expiring in 14 days", async () => {
    const r = await claimTrial("u1", "tok", clock, old)
    expect(r).toMatchObject({ ok: true, usd: 0.2, expiresAt: "2026-10-22T12:00:00.000Z" })
    expect(entries[0]).toMatchObject({ kind: "trial", amountMicros: 200_000n, externalRef: "trial:gh:1" })
    expect(await claimTrial("u1", "tok", clock, old)).toMatchObject({ ok: false, code: "already_claimed" })
    // A new Pullwright account for the same GitHub id gets nothing either.
    users.set("u9", { githubId: 1n, githubCreatedAt: new Date("2020-01-01") })
    expect(await claimTrial("u9", "tok", clock, old)).toMatchObject({ ok: false, code: "already_claimed" })
    expect(entries).toHaveLength(1)
  })

  it("refuses GitHub accounts younger than 30 days, and when the age can't be checked", async () => {
    expect(await claimTrial("u1", "tok", clock, async () => new Date("2026-09-20"))).toMatchObject({ ok: false, code: "account_too_new" })
    expect(await claimTrial("u2", "tok", clock, async () => null)).toMatchObject({ ok: false, code: "unknown_age" })
    expect(await claimTrial("u3", undefined, clock, old)).toMatchObject({ ok: false, code: "unknown_age" })
    expect(entries).toHaveLength(0)
  })

  it("stores the GitHub creation date so it is looked up once", async () => {
    const lookup = vi.fn(old)
    await claimTrial("u1", "tok", clock, lookup)
    expect(users.get("u1")!.githubCreatedAt).toEqual(new Date("2020-01-01"))
    await claimTrial("u1", "tok", clock, lookup)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it("hands out at most 3 trials per UTC day across everyone", async () => {
    for (const u of ["u1", "u2", "u3"]) expect((await claimTrial(u, "tok", clock, old)).ok).toBe(true)
    expect(await claimTrial("u4", "tok", clock, old)).toMatchObject({ ok: false, code: "sold_out_today" })
    clock = new Date("2026-10-09T00:00:01Z")
    expect((await claimTrial("u4", "tok", clock, old)).ok).toBe(true)
  })

  it("can be switched off", async () => {
    process.env.TRIAL_ENABLED = "0"
    expect(await claimTrial("u1", "tok", clock, old)).toMatchObject({ ok: false, code: "disabled" })
  })
})
