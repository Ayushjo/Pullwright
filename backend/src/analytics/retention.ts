import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import logger from "../logger.js"

/**
 * Raw analytics events are kept for ANALYTICS_RETENTION_MONTHS (default 13, so a month can be compared with
 * the same month last year), then deleted. The privacy page states this period.
 */
export const retentionMonths = () => Number(process.env.ANALYTICS_RETENTION_MONTHS ?? 13)

/** The cut-off: events older than this are deleted. */
export function retentionCutoff(now = new Date(), months = retentionMonths()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate(), now.getUTCHours()))
}

export async function pruneAnalytics(now = new Date()): Promise<number> {
  if (!isDatabaseEnabled() || retentionMonths() <= 0) return 0
  const { count } = await getPrisma().analyticsEvent.deleteMany({ where: { ts: { lt: retentionCutoff(now) } } })
  return count
}

/** Once a day (first run a few minutes after start). Deleting is idempotent, so several instances are harmless. */
export function startAnalyticsRetention(intervalMs = 24 * 3_600_000): NodeJS.Timeout {
  const tick = () =>
    pruneAnalytics()
      .then((n) => n && logger.info(`analytics retention: deleted ${n} events older than ${retentionMonths()} months`))
      .catch((err) => logger.warn(`analytics retention failed: ${(err as Error).message}`))
  setTimeout(tick, 5 * 60_000).unref()
  const t = setInterval(tick, intervalMs)
  t.unref()
  return t
}
