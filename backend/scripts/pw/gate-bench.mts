import { Sandbox } from "../../src/agent/sandbox.js"
import { Workspace } from "../../src/agent/workspace.js"
import { runVerify, runGate } from "../../src/agent/gate.js"
import { git } from "../../src/agent/git.js"

const root = process.argv[2]!
const ws = new Workspace(root)
const base = (await git(root, ["rev-list", "--max-parents=0", "HEAD"])).trim().split("\n")[0]!
const cmds = ["cd backend && npx tsc --noEmit -p .", "cd backend && npm test --silent", "cd frontend && npx tsc -b"]
let t = Date.now()
const sb = await Sandbox.create("bench", root, { network: false })
console.log("create", Date.now() - t, "ms"); t = Date.now()
for (const c of cmds) {
  const r = await sb.exec(c, 300_000)
  console.log("exec", Date.now() - t, "ms", r.exitCode, c); t = Date.now()
}
const g = await runGate({ ws, sb, baseSha: base, plannedFiles: [], planText: "", verifyCmds: cmds, baseline: [], unplannedSeen: new Set(), impactSeen: new Set(), untouchedSeen: new Set(), planSteps: [] })
console.log("gate total", Date.now() - t, "ms", "problems", g.problems.length)
await sb.destroy()
process.exit(0)
