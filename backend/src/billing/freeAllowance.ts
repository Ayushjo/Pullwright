import { getPrisma } from "../db/prisma.js"
import { getSpendLedger, poolBudget, nextUtcDay } from "../agent/spend.js"

/**
 * The free monthly Claude allowance: every eligible user gets N tasks a month on Claude (Haiku by
 * default), paid from the operator's budgeted promo pool (ANTHROPIC_POOL_*), with no key and no card.
 *
 * Counted in tasks, not dollars ("7 of 10 left"): a task is one started task this UTC month funded by
 * the allowance, except one cancelled before it spent anything. Each task is hard-capped
 * (FREE_CLAUDE_TASK_CAP_USD), so the pool's worst case is tasks × cap.
 *
 * Eligibility: the feature is on, the pool is configured, and the GitHub account is at least
 * FREE_CLAUDE_MIN_ACCOUNT_DAYS old (stored at sign-in). Availability also needs room in the pool
 * today and this month for one more capped task; otherwise it says when it comes back.
 */
export const FREE_CLAUDE = {
  enabled: () => process.env.FREE_CLAUDE_ENABLED !== "0" && Boolean(poolBudget("anthropic")) && Boolean(process.env.ANTHROPIC_API_KEY),
  tasksPerMonth: () => Number(process.env.FREE_CLAUDE_TASKS_PER_MONTH ?? 10),
  minAccountDays: () => Number(process.env.FREE_CLAUDE_MIN_ACCOUNT_DAYS ?? 30),
  taskCapUsd: () => Number(process.env.FREE_CLAUDE_TASK_CAP_USD ?? 0.15),
  model: () => process.env.FREE_CLAUDE_MODEL ?? "claude-haiku-5-5",
}

/**
 * Demo tasks: when someone has no key, no free Claude tasks left and no credits, a task can still run on the
 * operator's OpenAI key, inside its own budgeted pool (OPENAI_POOL_MONTHLY_USD / OPENAI_POOL_DAILY_USD) and
 * a per-task cap. Off unless that pool is configured; DEMO_OPENAI_ENABLED=0 turns it off.
 */
export const DEMO_OPENAI = {
  enabled: () => process.env.DEMO_OPENAI_ENABLED !== "0" && Boolean(poolBudget("openai")) && Boolean(process.env.OPENAI_API_KEY),
  taskCapUsd: () => Number(process.env.DEMO_TASK_CAP_USD ?? 0.15),
  model: () => process.env.DEMO_OPENAI_MODEL ?? "gpt-5-mini",
}

/** Whether a demo task can start now (the pool has room for one more capped task). */
export async function demoAvailable(now = new Date()): Promise<boolean> {
  if (!DEMO_OPENAI.enabled()) return false
  return (await poolHasRoom(DEMO_OPENAI.taskCapUsd(), now, "openai")).open
}

export type FreeAllowance = {
  enabled: boolean
  /** Why this account can't use it (account too new, unknown age), when it can't. */
  ineligible?: string
  limit: number
  used: number
  left: number
  /** UTC start of next month: when the allowance renews. */
  renewsAt: string
  /** False when today's (or this month's) shared pool can't cover one more task. */
  poolOpen: boolean
  /** When the pool reopens, if it's closed. */
  poolOpensAt?: string
  model: string
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
const nextMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))

/** Tasks this month that used the allowance (cancelled before spending anything doesn't count). */
export async function freeTasksUsed(userId: string, now = new Date()): Promise<number> {
  return getPrisma().task.count({
    where: {
      userId,
      createdAt: { gte: monthStart(now) },
      options: { path: ["fundedBy"], equals: "free_claude" },
      NOT: { AND: [{ status: "cancelled" }, { costUsd: { lt: 0.001 } }] },
    },
  })
}

/** Room in a provider's budgeted pool for one more capped task, today and this month. */
export async function poolHasRoom(cap = FREE_CLAUDE.taskCapUsd(), now = new Date(), provider: "anthropic" | "openai" = "anthropic"): Promise<{ open: boolean; opensAt?: number }> {
  const budget = poolBudget(provider)
  if (!budget) return { open: false }
  const spent = await getSpendLedger().poolSpent(provider)
  if (spent.monthUsd + cap > budget.monthlyUsd) return { open: false, opensAt: nextMonth(now).getTime() }
  if (spent.dayUsd + cap > budget.dailyUsd) return { open: false, opensAt: nextUtcDay(now.getTime()) }
  return { open: true }
}

export async function freeAllowance(userId: string, now = new Date()): Promise<FreeAllowance> {
  const limit = FREE_CLAUDE.tasksPerMonth()
  const base = { limit, renewsAt: nextMonth(now).toISOString(), model: FREE_CLAUDE.model() }
  if (!FREE_CLAUDE.enabled()) return { ...base, enabled: false, used: 0, left: 0, poolOpen: false }
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { githubCreatedAt: true } })
  const used = await freeTasksUsed(userId, now)
  const left = Math.max(0, limit - used)
  let ineligible: string | undefined
  if (!user?.githubCreatedAt) ineligible = "Sign out and in again so we can check your GitHub account."
  else if ((now.getTime() - user.githubCreatedAt.getTime()) / 86_400_000 < FREE_CLAUDE.minAccountDays()) {
    ineligible = `Free Claude tasks are for GitHub accounts older than ${FREE_CLAUDE.minAccountDays()} days.`
  }
  const pool = await poolHasRoom(undefined, now)
  return {
    ...base,
    enabled: true,
    ...(ineligible ? { ineligible } : {}),
    used,
    left,
    poolOpen: pool.open,
    ...(pool.opensAt ? { poolOpensAt: new Date(pool.opensAt).toISOString() } : {}),
  }
}

/** Whether a new task can start on the allowance right now. */
export const canUseFree = (a: FreeAllowance) => a.enabled && !a.ineligible && a.left > 0 && a.poolOpen
