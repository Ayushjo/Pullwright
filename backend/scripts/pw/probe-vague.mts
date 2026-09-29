/**
 * How the planner handles vague issues: runs only the plan stage (autoApprove off) for the vague variants
 * in evals/vague.json and prints whether it asked (blocked) or assumed, plus its requirements and risks,
 * next to the base ladder item's hidden acceptance test so the assumptions can be compared by hand.
 *
 *   npx tsx --env-file=.env scripts/pw/probe-vague.mts [--model gpt-5-mini] [V06-filters ...]
 *
 * Writes rows to .spend/vague-probes.jsonl. Costs one plan per item (~$0.005 on gpt-5-mini).
 */
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const API = process.env.PW_API ?? "http://localhost:3500"
const TOKEN = process.env.API_TOKEN!
const args = process.argv.slice(2)
const mi = args.indexOf("--model")
const MODEL = mi >= 0 ? args.splice(mi, 2)[1] : undefined
const vague = JSON.parse(readFileSync(path.join(backend, "evals/vague.json"), "utf8")) as { id: string; base: string; title: string; body: string }[]
const ladder = JSON.parse(readFileSync(path.join(backend, "evals/ladder.json"), "utf8")) as { id: string; fixture: string; acceptance: { code: string } | null }[]
const pick = args.length ? vague.filter((v) => args.includes(v.id)) : vague

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(API + p, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(j)}`)
  return j as Record<string, any>
}

for (const v of pick) {
  const base = ladder.find((l) => l.id === v.base)!
  const { taskId } = await api("POST", "/api/eval/task", { localRepo: base.fixture, title: v.title, body: v.body, autoApprove: false, ...(MODEL ? { model: MODEL } : {}) })
  let s: Record<string, any> = {}
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    s = await api("GET", `/api/task/${taskId}`)
    if (["awaiting_approval", "needs_input", "failed", "cancelled"].includes(s.status)) break
  }
  if (s.status === "awaiting_approval") await api("POST", `/api/task/${taskId}/cancel`).catch(() => {})
  const calls = await api("GET", `/api/task/${taskId}/calls`).catch(() => ({ calls: [] }))
  const cost = (calls.calls as { costUsd?: number }[] | undefined)?.reduce((a, c) => a + (c.costUsd ?? 0), 0) ?? 0
  const p = s.plan ?? {}
  const row = { ts: new Date().toISOString(), id: v.id, taskId, model: MODEL ?? "default", status: s.status, asked: Boolean(p.blocked), question: p.blocked ?? null, requirements: p.requirements ?? [], risks: p.risks ?? null, files: (p.files ?? []).map((f: { path: string }) => f.path), costUsd: Number(cost.toFixed(4)) }
  appendFileSync(path.join(backend, ".spend/vague-probes.jsonl"), JSON.stringify(row) + "\n")
  console.log(`\n▶ ${v.id} (${v.title} / "${v.body}") → ${s.status}${row.asked ? "  ASKED: " + row.question : ""}  $${row.costUsd}`)
  for (const r of row.requirements) console.log(`   R: ${r}`)
  if (row.risks) console.log(`   risks: ${String(row.risks).replace(/\s+/g, " ").slice(0, 300)}`)
  const asserts = (base.acceptance?.code ?? "").split("\n").filter((l) => /assert|expect|status|\?|query/.test(l)).slice(0, 8)
  console.log(`   hidden acceptance (${v.base}):\n     ${asserts.map((l) => l.trim().slice(0, 150)).join("\n     ")}`)
}
process.exit(0)
