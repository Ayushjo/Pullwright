import { Prisma } from "@prisma/client"
import { getPrisma } from "../db/prisma.js"
import logger from "../logger.js"

/**
 * Credits ledger (P4). Money is micro-USD (1 USD = 1_000_000). Every credit (Pro's monthly grant, a
 * purchased pack, the trial, a refund) and every debit (spend of a task that ran on our models) is one
 * row in `credit_ledger`. The balance is computed here, oldest-expiry first, so credit that expires soon
 * is spent before credit that lasts.
 *
 * Safety rules:
 *  - only tasks created with `fundedBy: "credits"` are ever debited (owner/eval tasks also run on our
 *    lanes and must never touch a ledger);
 *  - grants are idempotent through a unique `externalRef` (Dodo payment id, subscription period, trial id),
 *    so a webhook retry or a return-page sync after the webhook can't credit twice;
 *  - one debit row per task (unique task_id), updated as the task spends;
 *  - a new task's hard cap is at most what's available after what running tasks could still spend.
 */

export const MICROS = 1_000_000
export const toMicros = (usd: number) => Math.round(usd * MICROS)
export const toUsd = (micros: number | bigint) => Number(micros) / MICROS

export type CreditKindName = "grant" | "purchase" | "trial" | "debit" | "refund" | "adjust"
export type LedgerRow = { kind: CreditKindName; amountMicros: number; createdAt: Date; expiresAt: Date | null; taskId?: string | null }

export type Bucket = { kind: CreditKindName; remainingMicros: number; expiresAt: Date | null; createdAt: Date }

/**
 * Pure balance arithmetic. Rows are replayed in time order; each debit consumes credit that existed and
 * hadn't expired at the debit's time, earliest expiry first (never-expiring credit last). Credit that
 * expires simply stops counting; a debit that found nothing to consume is an overdraft (caps should make
 * that impossible, so it is reported, not hidden).
 */
export function computeBalance(rows: LedgerRow[], now: Date): { balanceMicros: number; buckets: Bucket[]; overdraftMicros: number } {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const buckets: Bucket[] = []
  let overdraft = 0
  const live = (b: Bucket, at: Date) => b.remainingMicros > 0 && (!b.expiresAt || b.expiresAt.getTime() > at.getTime())
  for (const r of sorted) {
    if (r.amountMicros > 0) {
      buckets.push({ kind: r.kind, remainingMicros: r.amountMicros, expiresAt: r.expiresAt, createdAt: r.createdAt })
      continue
    }
    let need = -r.amountMicros
    const usable = buckets
      .filter((b) => live(b, r.createdAt))
      .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime())
    for (const b of usable) {
      if (need <= 0) break
      const take = Math.min(b.remainingMicros, need)
      b.remainingMicros -= take
      need -= take
    }
    overdraft += need
  }
  const current = buckets.filter((b) => live(b, now))
  const balance = current.reduce((s, b) => s + b.remainingMicros, 0) - overdraft
  return { balanceMicros: balance, buckets: current, overdraftMicros: overdraft }
}

async function rowsFor(userId: string): Promise<LedgerRow[]> {
  const rows = await getPrisma().creditEntry.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
  return rows.map((r) => ({ kind: r.kind as CreditKindName, amountMicros: Number(r.amountMicros), createdAt: r.createdAt, expiresAt: r.expiresAt, taskId: r.taskId }))
}

/** Statuses in which a credit-funded task may still spend (its unspent cap is held back from new tasks). */
const MAY_SPEND = ["queued", "preparing", "planning", "awaiting_approval", "running", "validating", "verifying", "needs_input", "parked", "publishing"]

export type CreditSummary = {
  balanceUsd: number
  /** Balance minus what credit-funded tasks still running could spend. */
  availableUsd: number
  /** True when every unit of the available balance is trial credit (trial tasks get a smaller cap). */
  trialOnly: boolean
  nextExpiry: { atIso: string; usd: number } | null
  overdraftUsd: number
}

export async function creditSummary(userId: string, now = new Date()): Promise<CreditSummary> {
  const db = getPrisma()
  const [rows, active] = await Promise.all([
    rowsFor(userId),
    db.task.findMany({
      where: { userId, status: { in: MAY_SPEND as never }, options: { path: ["fundedBy"], equals: "credits" } },
      select: { id: true, costUsd: true, options: true },
    }),
  ])
  const { balanceMicros, buckets, overdraftMicros } = computeBalance(rows, now)
  const reserved = active.reduce((s, t) => {
    const cap = Number((t.options as { capUsd?: number } | null)?.capUsd ?? 0)
    return s + Math.max(0, toMicros(cap) - toMicros(Number(t.costUsd ?? 0)))
  }, 0)
  const expiring = buckets.filter((b) => b.expiresAt).sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())[0]
  return {
    balanceUsd: toUsd(balanceMicros),
    availableUsd: toUsd(Math.max(0, balanceMicros - reserved)),
    trialOnly: buckets.length > 0 && buckets.every((b) => b.kind === "trial"),
    nextExpiry: expiring ? { atIso: expiring.expiresAt!.toISOString(), usd: toUsd(expiring.remainingMicros) } : null,
    overdraftUsd: toUsd(overdraftMicros),
  }
}

/**
 * Add credit once. `externalRef` is unique: a second call with the same ref (webhook retry, sync after the
 * webhook) returns "duplicate" and changes nothing.
 */
export async function grantCredit(input: {
  userId: string
  kind: Exclude<CreditKindName, "debit">
  usd: number
  externalRef: string
  expiresAt?: Date | null
  note?: string
}): Promise<"granted" | "duplicate"> {
  if (!(input.usd > 0)) throw new Error("grant amount must be positive")
  try {
    await getPrisma().creditEntry.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        amountMicros: BigInt(toMicros(input.usd)),
        externalRef: input.externalRef,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
      },
    })
    logger.info(`Credits: ${input.kind} +$${input.usd.toFixed(2)} for ${input.userId} (${input.externalRef})`)
    return "granted"
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate"
    throw err
  }
}

/**
 * Record what a credit-funded task has spent so far: one row per task, created on first spend and updated
 * after (spend only grows). Callers must only pass tasks whose options say `fundedBy: "credits"`.
 */
export async function recordTaskSpend(userId: string, taskId: string, costUsd: number): Promise<void> {
  const micros = toMicros(costUsd)
  if (micros <= 0) return
  await getPrisma().creditEntry.upsert({
    where: { taskId },
    create: { userId, taskId, kind: "debit", amountMicros: BigInt(-micros), note: "task spend" },
    update: { amountMicros: BigInt(-micros) },
  })
}

export async function ledgerHistory(userId: string, limit = 20) {
  const rows = await getPrisma().creditEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit })
  return rows.map((r) => ({
    kind: r.kind as CreditKindName,
    usd: toUsd(r.amountMicros),
    note: r.note,
    taskId: r.taskId,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}
