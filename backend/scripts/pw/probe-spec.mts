/**
 * The specification check alone (intake/specCheck.ts + decide.ts) on ladder issues and their vague
 * variants: does it stop well-specified issues (unnecessary asks) and does it catch the vague ones?
 *
 *   npx tsx --env-file=.env scripts/pw/probe-spec.mts            # all ladder items + evals/vague.json
 *   npx tsx --env-file=.env scripts/pw/probe-spec.mts L09 V06    # a subset
 *
 * Uses the fixture repos in .tasks/eval-repos (run eval.mts once to create them) for the repo map and
 * grounding, and the plan lane (PW_LANES_PLAN or the configured plan model). One call per item; rows go
 * to .spend/spec-probes.jsonl.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Workspace } from "../../src/agent/workspace.js"
import { buildRepoMap } from "../../src/agent/repoMap.js"
import { groundIssue, groundingNote } from "../../src/agent/grounding.js"
import { specCheck } from "../../src/agent/intake/specCheck.js"
import { decide } from "../../src/agent/intake/decide.js"
import { chatVia, laneFromSpec, parseLanes } from "../../src/llm/lanes.js"

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const repos = process.env.EVAL_REPOS_DIR ?? path.join(backend, ".tasks/eval-repos")
type Item = { id: string; fixture?: string; base?: string; title: string; body: string; expect?: string }
const ladder = JSON.parse(readFileSync(path.join(backend, "evals/ladder.json"), "utf8")) as Item[]
const vague = (JSON.parse(readFileSync(path.join(backend, "evals/vague.json"), "utf8")) as Item[]).map((v) => ({ ...v, fixture: ladder.find((l) => l.id === v.base)!.fixture }))
const want = process.argv.slice(2)
const items = [...ladder, ...vague].filter((i) => !want.length || want.some((w) => i.id.startsWith(w)))

const provider = (process.env.PW_LLM_PROVIDER ?? "openai") as "openai" | "vercel"
const model = process.env.PW_PLAN_MODEL ?? "gpt-5-mini"
const lanes = parseLanes(process.env.PW_LANES_PLAN, "low")
const chat = chatVia(lanes.length ? lanes : [laneFromSpec({ provider, model: provider === "vercel" && !model.includes("/") ? `openai/${model}` : model, reasoningEffort: "low" })])

let asked = 0
let cost = 0
for (const it of items) {
  const dir = path.join(repos, it.fixture!)
  if (!existsSync(dir)) {
    console.log(`${it.id}: fixture repo ${dir} missing — run eval.mts once`)
    continue
  }
  const ws = new Workspace(dir)
  const text = `${it.title}\n${it.body}`
  const [map, grounding] = await Promise.all([buildRepoMap(ws, text), groundIssue(ws, text)])
  let callCost = 0
  const spec = await specCheck(
    { title: it.title, body: it.body, comments: [], attachments: "", grounding: groundingNote(grounding), repoMap: map.text },
    (o) => chat({ ...o, onUsage: (u) => (callCost += u.costUsd) }),
    `probe-spec-${it.id}`,
  ).catch((e) => {
    console.log(`${it.id}: ${(e as Error).message}`)
    return null
  })
  cost += callCost
  const d = decide(spec)
  if (d.action === "ask") asked++
  const row = { ts: new Date().toISOString(), id: it.id, expect: it.expect ?? (it.id.startsWith("V") ? "vague" : "clear"), underspec: spec?.underspec ?? null, decision: d.action, questions: spec?.questions ?? [], costUsd: Number(callCost.toFixed(5)) }
  appendFileSync(path.join(backend, ".spend/spec-probes.jsonl"), JSON.stringify(row) + "\n")
  console.log(`${it.id.padEnd(30)} underspec=${row.underspec} → ${d.action.toUpperCase()}${row.expect !== "clear" ? `  (expected: ${row.expect})` : ""}`)
  for (const q of row.questions) console.log(`    ${q.id} [${q.impact}${q.answerableFromCode ? ", code" : ""}] ${q.question}  → default: ${q.default}`)
}
console.log(`\n${items.length} items, ${asked} stopped to ask, $${cost.toFixed(4)}`)
process.exit(0)
