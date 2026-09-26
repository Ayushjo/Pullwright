import { Router } from "express"
import type { EventLog } from "../events/eventLog.js"
import { getPrisma, isDatabaseEnabled } from "../db/prisma.js"
import { taskStore } from "../agent/store.js"

/**
 * Public, read-only replays of tasks their owner chose to share (isPublic).
 * This is what the landing page links to: real runs, zero model spend to watch.
 */
export function createPublicRouter(eventLog: EventLog) {
  const router = Router()

  async function isPublic(taskId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/.test(taskId) || !isDatabaseEnabled()) return false
    const row = await getPrisma().task.findUnique({ where: { id: taskId }, select: { isPublic: true } })
    return Boolean(row?.isPublic)
  }

  router.get("/task/:taskId", async (req, res) => {
    const taskId = String(req.params.taskId)
    if (!(await isPublic(taskId))) return res.status(404).json({ error: "Not found" })
    const row = await getPrisma().task.findUnique({ where: { id: taskId } })
    if (!row) return res.status(404).json({ error: "Not found" })
    const live = await taskStore.get(taskId)
    const patch = await taskStore.loadPatch(taskId)
    res.json({
      taskId,
      issueUrl: row.issueUrl,
      title: row.issueTitle,
      issueNumber: row.issueNumber,
      repo: `${row.repoOwner}/${row.repoName}`,
      status: row.status,
      prUrl: row.prUrl,
      plan: row.plan,
      summary: row.summary,
      verdict: row.verdict,
      stats: row.diffStats,
      costUsd: row.costUsd,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      patch: patch ?? null,
      checklist: live?.planChecklist ?? null,
    })
  })

  router.get("/task/:taskId/events", async (req, res) => {
    const taskId = String(req.params.taskId)
    if (!(await isPublic(taskId))) return res.status(404).json({ error: "Not found" })
    res.json(await eventLog.range(taskId, 0))
  })

  return router
}
