import { getPrisma } from "../db/prisma.js"
import logger from "../logger.js"
import { Prisma } from "@prisma/client"
import { toMicros } from "./credits.js"

/**
 * The free trial: $0.20 of our models (2 tasks at the $0.10 trial cap) so someone can see a real PR before
 * adding a key or paying. Abuse limits, all server-side:
 *  - one trial per GitHub account (ledger ref `trial:gh:<githubId>`, unique), so deleting and re-creating a
 *    Pullwright account doesn't get a second one;
 *  - the GitHub account must be at least TRIAL_MIN_ACCOUNT_DAYS old (fresh throwaway accounts get nothing);
 *  - at most TRIAL_DAILY_MAX trials are handed out per UTC day across everyone, so the worst case is bounded
 *    (default 3 × $0.20 = $0.60/day);
 *  - trial credit expires after TRIAL_VALID_DAYS and trial tasks run on the free queue.
 */
export const TRIAL = {
  enabled: () => process.env.TRIAL_ENABLED !== "0",
  usd: () => Number(process.env.TRIAL_USD ?? 0.2),
  minAccountDays: () => Number(process.env.TRIAL_MIN_ACCOUNT_DAYS ?? 30),
  dailyMax: () => Number(process.env.TRIAL_DAILY_MAX ?? 3),
  validDays: () => Number(process.env.TRIAL_VALID_DAYS ?? 14),
}

export type TrialResult =
  | { ok: true; usd: number; expiresAt: string }
  | { ok: false; code: "disabled" | "already_claimed" | "account_too_new" | "sold_out_today" | "unknown_age"; error: string }

/** GitHub's account creation date, from the signed-in user's own token. */
export async function fetchGithubCreatedAt(token: string): Promise<Date | null> {
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "pullwright" },
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return null
    const d = (await r.json()) as { created_at?: string }
    const t = d.created_at ? new Date(d.created_at) : null
    return t && !Number.isNaN(t.getTime()) ? t : null
  } catch {
    return null
  }
}

export async function trialStatus(userId: string): Promise<{ available: boolean; claimed: boolean; usd: number }> {
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { id: userId }, select: { githubId: true } })
  const claimed = user ? Boolean(await db.creditEntry.findUnique({ where: { externalRef: `trial:gh:${user.githubId}` }, select: { id: true } })) : false
  return { available: TRIAL.enabled() && !claimed, claimed, usd: TRIAL.usd() }
}

export async function claimTrial(userId: string, githubToken: string | undefined, now = new Date(), lookup = fetchGithubCreatedAt): Promise<TrialResult> {
  if (!TRIAL.enabled()) return { ok: false, code: "disabled", error: "The free trial isn't available right now." }
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { id: userId }, select: { githubId: true, githubCreatedAt: true } })
  if (!user) return { ok: false, code: "unknown_age", error: "Sign in again." }
  const ref = `trial:gh:${user.githubId}`
  if (await db.creditEntry.findUnique({ where: { externalRef: ref }, select: { id: true } })) {
    return { ok: false, code: "already_claimed", error: "This GitHub account has already used its free trial." }
  }

  let created = user.githubCreatedAt
  if (!created && githubToken) {
    created = await lookup(githubToken)
    if (created) await db.user.update({ where: { id: userId }, data: { githubCreatedAt: created } })
  }
  if (!created) return { ok: false, code: "unknown_age", error: "Couldn't check your GitHub account — sign in again and retry." }
  const ageDays = (now.getTime() - created.getTime()) / 86_400_000
  if (ageDays < TRIAL.minAccountDays()) {
    return { ok: false, code: "account_too_new", error: `The free trial is for GitHub accounts older than ${TRIAL.minAccountDays()} days. Add a free Gemini key instead — it takes 2 minutes and needs no card.` }
  }

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const expiresAt = new Date(now.getTime() + TRIAL.validDays() * 86_400_000)
  // Count-then-grant under a transaction-scoped advisory lock, so simultaneous claims can't overshoot the
  // daily cap. The unique ref still guarantees one trial per GitHub account.
  const out = await db
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7240001)`
      const today = await tx.creditEntry.count({ where: { kind: "trial", createdAt: { gte: dayStart } } })
      if (today >= TRIAL.dailyMax()) return { sold: true as const, today }
      await tx.creditEntry.create({
        data: { userId, kind: "trial", amountMicros: BigInt(toMicros(TRIAL.usd())), externalRef: ref, expiresAt, note: "Free trial" },
      })
      return { today }
    })
    .catch((err) => {
      // A unique violation aborts the transaction; it means this account claimed in a parallel request.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { dup: true as const, today: 0 }
      throw err
    })
  if ("sold" in out) {
    return { ok: false, code: "sold_out_today", error: "Today's free trials are all claimed — try again tomorrow, or add a free Gemini key now." }
  }
  if ("dup" in out) return { ok: false, code: "already_claimed", error: "This GitHub account has already used its free trial." }
  const today = out.today
  logger.info(`Trial claimed by ${userId} (${today + 1}/${TRIAL.dailyMax()} today)`)
  return { ok: true, usd: TRIAL.usd(), expiresAt: expiresAt.toISOString() }
}
