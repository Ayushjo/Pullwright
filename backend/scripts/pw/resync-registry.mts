/**
 * One-off repair: make the task list (registry) and Postgres agree with each task's real state.
 * Before the cancel fix, idle cancels changed the task but not the list, so lists kept showing
 * "Review plan" / "Paused" for cancelled tasks and inflated the Dashboard's "Needs you".
 *
 *   npx tsx --env-file=.env scripts/pw/resync-registry.mts          # dry run
 *   npx tsx --env-file=.env scripts/pw/resync-registry.mts --apply
 */
import { createRedisClient } from "../../src/config/redis.js"
import { taskStore } from "../../src/agent/store.js"
import { makeStatusSink } from "../../src/agent/service.js"
import { TaskRegistry } from "../../src/store/taskRegistry.js"

const apply = process.argv.includes("--apply")
const redis = createRedisClient()
const registry = new TaskRegistry()
const sink = makeStatusSink(registry)

const ids = await redis.zrevrange("tasks:index", 0, -1)
let stale = 0
for (const id of ids) {
  const entry = await registry.get(id)
  const state = await taskStore.get(id)
  if (!entry || !state || entry.status === state.status) continue
  stale++
  console.log(`${id.slice(0, 8)}  list=${entry.status}  task=${state.status}  ${entry.issueTitle.slice(0, 60)}`)
  if (apply) await sink(state)
}
console.log(`${stale} stale of ${ids.length}${apply ? " — fixed" : " (dry run; pass --apply)"}`)
process.exit(0)
