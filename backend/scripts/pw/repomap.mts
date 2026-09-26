import { Workspace } from "../../src/agent/workspace.js"
import { buildRepoMap } from "../../src/agent/repoMap.js"
import { detectRepoConfig } from "../../src/agent/repoConfig.js"
const ws = new Workspace(process.argv[2]!)
const t0 = Date.now()
const m = await buildRepoMap(ws, process.argv[3]!)
console.log(m.text.slice(0, 3500))
console.log("\n--- chars", m.text.length, "ms", Date.now() - t0)
console.log(await detectRepoConfig(ws))
