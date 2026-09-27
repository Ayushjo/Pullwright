import { getPrisma } from "../../src/db/prisma.js"
const db = getPrisma()
const id = "9f20af7f-8464-4920-881a-0d3031f396b7"
for (let i = 0; i < 3; i++) {
  let t = Date.now(); await db.task.updateMany({ where: { id }, data: { costUsd: 0.0785 } }); console.log("updateMany", Date.now() - t, "ms")
}
let t = Date.now()
await Promise.all(Array.from({ length: 40 }, (_, i) => db.taskEvent.count({ where: { taskId: id } })))
console.log("40 parallel queries", Date.now() - t, "ms")
t = Date.now(); await db.task.updateMany({ where: { id }, data: { costUsd: 0.0785 } }); console.log("update after burst", Date.now() - t, "ms")
process.exit(0)
