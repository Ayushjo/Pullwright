import { Prisma } from "@prisma/client"
import { getPrisma } from "../db/prisma.js"

/**
 * The owner's analytics report over the last N days (UTC), straight from analytics_events, users and
 * tasks. Every query is parameterised and aggregated in Postgres.
 */
export type AnalyticsReport = {
  days: number
  since: string
  totals: { visitors: number; sessions: number; pageViews: number; signups: number; activeUsers: number; tasksCreated: number; prsPublished: number; purchases: number }
  daily: { day: string; visitors: number; signups: number; tasks: number }[]
  funnel: { stage: string; count: number }[]
  sources: { source: string; sessions: number; signups: number }[]
  pages: { path: string; views: number; visitors: number }[]
  devices: { device: string; visitors: number }[]
  countries: { country: string; visitors: number }[]
  refusals: { code: string; count: number }[]
  recentSignups: { login: string; createdAt: string; lastSeenAt: string | null; tasks: number; firstTouch: unknown }[]
}

const n = (v: unknown) => Number(v ?? 0)

export async function analyticsReport(days = 30): Promise<AnalyticsReport> {
  const db = getPrisma()
  const since = new Date(Date.now() - days * 86_400_000)
  const q = <T>(sql: Prisma.Sql) => db.$queryRaw<T[]>(sql)

  const [totals] = await q<Record<string, unknown>>(Prisma.sql`
    SELECT
      COUNT(DISTINCT anon_id) FILTER (WHERE name = 'page_view')            AS visitors,
      COUNT(DISTINCT session_id) FILTER (WHERE name = 'page_view')         AS sessions,
      COUNT(*) FILTER (WHERE name = 'page_view')                           AS page_views,
      COUNT(*) FILTER (WHERE name = 'signup')                              AS signups,
      COUNT(DISTINCT user_id)                                              AS active_users,
      COUNT(*) FILTER (WHERE name = 'task_created')                        AS tasks_created,
      COUNT(*) FILTER (WHERE name = 'pr_published')                        AS prs_published,
      COUNT(*) FILTER (WHERE name IN ('purchase', 'subscription_active'))  AS purchases
    FROM analytics_events WHERE ts >= ${since}`)

  const daily = await q<{ day: Date; visitors: unknown; signups: unknown; tasks: unknown }>(Prisma.sql`
    SELECT d.day,
      COUNT(DISTINCT e.anon_id) FILTER (WHERE e.name = 'page_view') AS visitors,
      COUNT(*) FILTER (WHERE e.name = 'signup')                    AS signups,
      COUNT(*) FILTER (WHERE e.name = 'task_created')              AS tasks
    FROM generate_series(date_trunc('day', ${since}::timestamptz AT TIME ZONE 'UTC'), date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS d(day)
    LEFT JOIN analytics_events e ON date_trunc('day', e.ts AT TIME ZONE 'UTC') = d.day AND e.ts >= ${since}
    GROUP BY d.day ORDER BY d.day`)

  // Funnel over the window: distinct people at each stage (visitors by anon id, the rest by account).
  const [f] = await q<Record<string, unknown>>(Prisma.sql`
    SELECT
      COUNT(DISTINCT anon_id) FILTER (WHERE name = 'page_view')                                                      AS visited,
      COUNT(DISTINCT user_id) FILTER (WHERE name = 'signup')                                                         AS signed_up,
      COUNT(DISTINCT user_id) FILTER (WHERE name = 'task_created')                                                   AS created_task,
      COUNT(DISTINCT user_id) FILTER (WHERE name = 'task_finished' AND props->>'status' IN ('ready', 'needs_review')) AS got_result,
      COUNT(DISTINCT user_id) FILTER (WHERE name = 'pr_published')                                                   AS published_pr,
      COUNT(DISTINCT user_id) FILTER (WHERE name IN ('purchase', 'subscription_active'))                             AS paid
    FROM analytics_events WHERE ts >= ${since}`)

  // A session's source = its attributed referrer host or UTM source (the first event that carries one).
  const sources = await q<{ source: string; sessions: unknown; signups: unknown }>(Prisma.sql`
    WITH s AS (
      SELECT DISTINCT ON (session_id) session_id, anon_id,
        COALESCE(NULLIF(utm_source, ''), split_part(referrer, '/', 1), 'direct') AS source
      FROM analytics_events
      WHERE ts >= ${since} AND name = 'page_view' AND session_id IS NOT NULL
      ORDER BY session_id, (utm_source IS NULL AND referrer IS NULL), ts
    )
    SELECT s.source, COUNT(*) AS sessions,
      COUNT(DISTINCT u.user_id) AS signups
    FROM s LEFT JOIN LATERAL (
      SELECT e.user_id FROM analytics_events e WHERE e.anon_id = s.anon_id AND e.name = 'identify' AND e.ts >= ${since} LIMIT 1
    ) u ON true
    GROUP BY s.source ORDER BY sessions DESC LIMIT 12`)

  const pages = await q<{ path: string; views: unknown; visitors: unknown }>(Prisma.sql`
    SELECT path, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS visitors
    FROM analytics_events WHERE ts >= ${since} AND name = 'page_view' AND path IS NOT NULL
    GROUP BY path ORDER BY views DESC LIMIT 12`)

  const devices = await q<{ device: string; visitors: unknown }>(Prisma.sql`
    SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT anon_id) AS visitors
    FROM analytics_events WHERE ts >= ${since} AND name = 'page_view' GROUP BY 1 ORDER BY 2 DESC`)

  const countries = await q<{ country: string; visitors: unknown }>(Prisma.sql`
    SELECT COALESCE(country, '—') AS country, COUNT(DISTINCT anon_id) AS visitors
    FROM analytics_events WHERE ts >= ${since} AND name = 'page_view' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)

  const refusals = await q<{ code: string; count: unknown }>(Prisma.sql`
    SELECT COALESCE(props->>'code', 'unknown') AS code, COUNT(*) AS count
    FROM analytics_events WHERE ts >= ${since} AND name = 'limit_hit' GROUP BY 1 ORDER BY 2 DESC`)

  const recent = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { login: true, createdAt: true, lastSeenAt: true, firstTouch: true, _count: { select: { tasks: true } } },
  })

  return {
    days,
    since: since.toISOString(),
    totals: {
      visitors: n(totals?.visitors),
      sessions: n(totals?.sessions),
      pageViews: n(totals?.page_views),
      signups: n(totals?.signups),
      activeUsers: n(totals?.active_users),
      tasksCreated: n(totals?.tasks_created),
      prsPublished: n(totals?.prs_published),
      purchases: n(totals?.purchases),
    },
    daily: daily.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), visitors: n(d.visitors), signups: n(d.signups), tasks: n(d.tasks) })),
    funnel: [
      { stage: "Visited", count: n(f?.visited) },
      { stage: "Signed up", count: n(f?.signed_up) },
      { stage: "Started a task", count: n(f?.created_task) },
      { stage: "Got a result", count: n(f?.got_result) },
      { stage: "Published a PR", count: n(f?.published_pr) },
      { stage: "Paid", count: n(f?.paid) },
    ],
    sources: sources.map((s) => ({ source: s.source || "direct", sessions: n(s.sessions), signups: n(s.signups) })),
    pages: pages.map((p) => ({ path: p.path, views: n(p.views), visitors: n(p.visitors) })),
    devices: devices.map((d) => ({ device: d.device, visitors: n(d.visitors) })),
    countries: countries.map((c) => ({ country: c.country, visitors: n(c.visitors) })),
    refusals: refusals.map((r) => ({ code: r.code, count: n(r.count) })),
    recentSignups: recent.map((u) => ({ login: u.login, createdAt: u.createdAt.toISOString(), lastSeenAt: u.lastSeenAt?.toISOString() ?? null, tasks: u._count.tasks, firstTouch: u.firstTouch })),
  }
}
