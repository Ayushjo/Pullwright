/**
 * Capability matrix per lane (provider × model), using the platform's own keys:
 *
 *   npx tsx --env-file=.env scripts/pw/probe-lanes.mts gemini:gemini-3.5-flash-lite groq:openai/gpt-oss-120b vercel:openai/gpt-5-nano
 *
 * For each lane: a forced tool call, a request for two parallel tool calls, JSON mode, and a two-turn
 * tool conversation (the Gemini thought-signature round trip). Prints a table and appends rows to
 * .spend/lane-probes.jsonl. Each lane costs a handful of tiny requests (free tiers: a few of the day's quota).
 */
import { appendFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chat, type Msg } from "../../src/agent/llm.js"
import { parseLanes } from "../../src/llm/lanes.js"
import { classifyError } from "../../src/llm/errors.js"

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const tools = [{ type: "function" as const, function: { name: "view", description: "View a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }]
const lanes = parseLanes(process.argv.slice(2).join(","), "low")
if (!lanes.length) {
  console.log("usage: probe-lanes.mts provider:model [...]  (providers need their platform key in .env)")
  process.exit(1)
}

type Row = Record<string, string | number | boolean>
const rows: Row[] = []
for (const lane of lanes) {
  const spec = { provider: lane.provider, model: lane.model, spendClass: lane.spendClass, reasoningEffort: "low" as const }
  const base = { taskId: "probe-lanes", purpose: "probe", maxOutputTokens: 800, attempts: 1, timeoutMs: 60_000 }
  const row: Row = { lane: `${lane.provider}:${lane.model}` }
  const t0 = Date.now()
  const step = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      row[name] = `✗ ${classifyError(e).cls}`
      return null
    }
  }
  const one = await step("tool", () => chat(spec, { ...base, messages: [{ role: "user", content: "Open src/a.ts with the view tool." }], tools, toolChoice: "required" }))
  if (one) {
    row.tool = one.toolCalls.length ? "✓" : "✗ none"
    row.latencyMs = Date.now() - t0
    // Two-turn: send the tool call back (with its sidecars) and ask for an answer.
    const msgs: Msg[] = [
      { role: "user", content: "Open src/a.ts with the view tool, then say what it exports." },
      { role: "assistant", content: null, tool_calls: one.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.rawArgs }, ...(t.extra ? { extra_content: t.extra } : {}), _origin: t.origin })) } as unknown as Msg,
      ...one.toolCalls.map((t) => ({ role: "tool" as const, tool_call_id: t.id, content: "export const answer = 42" })),
    ]
    const two = await step("twoTurn", () => chat(spec, { ...base, messages: msgs, tools }))
    if (two) row.twoTurn = /42|answer/i.test(two.text) ? "✓" : "? no answer"
  }
  const par = await step("parallel", () => chat(spec, { ...base, messages: [{ role: "user", content: "Open src/a.ts and src/b.ts with the view tool — issue both calls in this one turn." }], tools, toolChoice: "required" }))
  if (par) row.parallel = par.toolCalls.length >= 2 ? "✓" : `✗ ${par.toolCalls.length} call`
  const json = await step("json", () => chat(spec, { ...base, messages: [{ role: "user", content: 'Return JSON {"ok": true} and nothing else.' }], jsonMode: true }))
  if (json) {
    try {
      row.json = JSON.parse(json.text.match(/\{[\s\S]*\}/)?.[0] ?? "").ok === true ? "✓" : "✗"
    } catch {
      row.json = "✗ invalid"
    }
  }
  rows.push(row)
  appendFileSync(path.join(backend, ".spend/lane-probes.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n")
}
console.table(rows)
process.exit(0)
