/**
 * Reviewer qualification: replay stored (patch, plan, verification) inputs whose hidden acceptance test
 * result is known (evals/judge-replay/*.json) through each candidate reviewer lane, one call per item.
 *
 *   npx tsx --env-file=.env scripts/pw/probe-judge.mts vercel:openai/gpt-5-mini groq:openai/gpt-oss-120b gemini:gemini-3.5-flash-lite
 *   npx tsx --env-file=.env scripts/pw/probe-judge.mts --limit 20 groq:qwen/qwen3.8-27b
 *   npx tsx --env-file=.env scripts/pw/probe-judge.mts --only H06,H07 groq:openai/gpt-oss-120b   # the large ones (compact path)
 *
 * Reports per lane: false approvals (label fail, reviewer says success — the dangerous one), false
 * rejections (label pass, reviewer says fail), items the lane couldn't take (Groq's 8K request cap),
 * cost and latency. Rows go to .spend/judge-probes.jsonl.
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { judgePatch } from "../../src/agent/judge.js"
import { chatVia, parseLanes } from "../../src/llm/lanes.js"
import { NoLaneAvailable } from "../../src/llm/gateway.js"

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const dir = path.join(backend, "evals/judge-replay")
const argv = process.argv.slice(2)
const li = argv.indexOf("--limit")
const LIMIT = li >= 0 ? Number(argv.splice(li, 2)[1]) : Infinity
// --only <prefix,prefix>: just the items whose id starts with one of these (e.g. H06,H07 to retry the large ones).
const oi = argv.indexOf("--only")
const ONLY = oi >= 0 ? argv.splice(oi, 2)[1]!.split(",") : null
const lanes = parseLanes(argv.join(","), "low")
if (!lanes.length) {
  console.log("usage: probe-judge.mts [--limit N] provider:model [...]")
  process.exit(1)
}
type Item = { id: string; source: string; label: "pass" | "fail"; title: string; body: string; plan: string; requirements: string[]; summary: string; patch: string; verify: string }
const items = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && (!ONLY || ONLY.some((p) => f.startsWith(p))))
  .sort()
  .slice(0, LIMIT)
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Item)
console.log(`${items.length} items (${items.filter((i) => i.label === "pass").length} pass / ${items.filter((i) => i.label === "fail").length} fail)`)

for (const lane of lanes) {
  const name = `${lane.provider}/${lane.model}`
  const chat = chatVia([lane])
  const tally = { n: 0, agree: 0, falseApprove: 0, falseReject: 0, tooLarge: 0, error: 0, cost: 0, ms: 0 }
  for (const it of items) {
    const t0 = Date.now()
    let outcome: string
    let success: boolean | null = null
    let cost = 0
    try {
      const v = await judgePatch(chat, `probe-judge-${it.id}`, { title: it.title, body: it.body, plan: it.plan, requirements: it.requirements, summary: it.summary, patch: it.patch, verify: it.verify }, (u) => (cost += u.costUsd))
      success = v.success
      tally.n++
      if ((it.label === "pass") === v.success) {
        tally.agree++
        outcome = "agree"
      } else if (v.success) {
        tally.falseApprove++
        outcome = "FALSE_APPROVE"
      } else {
        tally.falseReject++
        outcome = "false_reject"
      }
    } catch (e) {
      const tooLarge = e instanceof NoLaneAvailable && e.attempts.some((a) => a.outcome === "skipped" || a.outcome === "too_large")
      outcome = tooLarge ? "too_large" : `error: ${(e as Error).message.slice(0, 80)}`
      if (tooLarge) tally.tooLarge++
      else tally.error++
    }
    tally.cost += cost
    tally.ms += Date.now() - t0
    appendFileSync(path.join(backend, ".spend/judge-probes.jsonl"), JSON.stringify({ ts: new Date().toISOString(), lane: name, item: it.id, source: it.source, label: it.label, success, outcome, costUsd: +cost.toFixed(5), ms: Date.now() - t0 }) + "\n")
    process.stdout.write(outcome === "agree" ? "." : outcome === "FALSE_APPROVE" ? "A" : outcome === "false_reject" ? "r" : outcome === "too_large" ? "L" : "E")
  }
  const fails = items.filter((i) => i.label === "fail").length
  const passes = items.filter((i) => i.label === "pass").length
  console.log(`\n${name}: judged ${tally.n}/${items.length} · agree ${tally.agree} · false approvals ${tally.falseApprove}/${fails} · false rejections ${tally.falseReject}/${passes} · too large ${tally.tooLarge} · errors ${tally.error} · $${tally.cost.toFixed(4)} · ${(tally.ms / Math.max(1, items.length) / 1000).toFixed(1)} s/item`)
}
process.exit(0)
