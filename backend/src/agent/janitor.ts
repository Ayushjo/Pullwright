import { existsSync } from "fs"
import { readdir, rm, stat } from "fs/promises"
import path from "path"
import logger from "../logger.js"
import { evictDeps } from "./depCache.js"
import { tasksRoot } from "./git.js"
import { Sandbox } from "./sandbox.js"
import { taskStore, TERMINAL, type TaskStatus } from "./store.js"

/**
 * Keeps worker disk bounded. A task workspace is ~95% node_modules (≈600 MB here), so:
 *  - finished tasks (published/failed/cancelled): the whole workspace goes after JANITOR_TERMINAL_HOURS;
 *  - idle tasks (waiting on the user): only node_modules goes after JANITOR_IDLE_MINUTES — the run
 *    stage restores it from the dependency cache in seconds if the user comes back;
 *  - workspaces with no task state (expired or orphaned): node_modules after an hour, the rest after a day.
 */
const IDLE: TaskStatus[] = ["awaiting_approval", "needs_input", "ready", "needs_review"]
const hours = (h: number) => h * 3_600_000

async function nodeModulesDirs(root: string, depth = 3): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, d: number) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git") continue
      const p = path.join(dir, e.name)
      if (e.name === "node_modules") out.push(p)
      else if (d > 1) await walk(p, d - 1)
    }
  }
  await walk(root, depth)
  return out
}

export async function sweepWorkspaces(now = Date.now()): Promise<{ removed: number; slimmed: number }> {
  const root = tasksRoot()
  let removed = 0
  let slimmed = 0
  if (!existsSync(root)) return { removed, slimmed }
  const terminalMs = hours(Number(process.env.JANITOR_TERMINAL_HOURS ?? 1))
  const idleMs = Number(process.env.JANITOR_IDLE_MINUTES ?? 30) * 60_000
  for (const id of await readdir(root)) {
    const dir = path.join(root, id)
    const st = await stat(dir).catch(() => null)
    if (!st?.isDirectory()) continue
    const s = await taskStore.get(id).catch(() => null)
    const age = now - (s ? Date.parse(s.updatedAt) : st.mtimeMs)
    if (!s) {
      // No state (expired or orphaned): nobody can resume it, so node_modules can go early.
      if (age > hours(24)) {
        await rm(dir, { recursive: true, force: true })
        removed++
      } else if (age > hours(1)) {
        const mods = await nodeModulesDirs(path.join(dir, "repo"))
        for (const m of mods) await rm(m, { recursive: true, force: true })
        if (mods.length) slimmed++
      }
      continue
    }
    if (TERMINAL.includes(s.status) && age > terminalMs) {
      await rm(dir, { recursive: true, force: true })
      removed++
    } else if (IDLE.includes(s.status) && age > idleMs) {
      const mods = await nodeModulesDirs(path.join(dir, "repo"))
      if (!mods.length) continue
      // Re-check right before deleting: the user may have just resumed the task.
      const fresh = await taskStore.get(id)
      if (!fresh || !IDLE.includes(fresh.status)) continue
      for (const m of mods) await rm(m, { recursive: true, force: true })
      slimmed++
    }
  }
  await evictDeps()
  // Containers left behind by a crashed worker: no stage holds a sandbox for anywhere near 3 h.
  await Sandbox.reapStale(hours(Number(process.env.JANITOR_CONTAINER_MAX_HOURS ?? 3))).catch(() => 0)
  return { removed, slimmed }
}

export function startJanitor(intervalMs = 10 * 60_000): NodeJS.Timeout {
  const tick = () =>
    sweepWorkspaces()
      .then((r) => (r.removed || r.slimmed) && logger.info(`janitor: removed ${r.removed} workspaces, slimmed ${r.slimmed}`))
      .catch((err) => logger.warn(`janitor failed: ${(err as Error).message}`))
  setTimeout(tick, 60_000).unref()
  const t = setInterval(tick, intervalMs)
  t.unref()
  return t
}
