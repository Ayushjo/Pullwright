/**
 * Score a task started from the GUI against a ladder item's checks / acceptance test.
 *   npx tsx --env-file=.env scripts/pw/check.mts <taskId> <ladderIdPrefix>
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const [taskId, prefix] = process.argv.slice(2)
const item = (JSON.parse(readFileSync(path.join(backend, "evals/ladder.json"), "utf8")) as any[]).find((i) => i.id.startsWith(prefix!))
if (!taskId || !item) throw new Error("usage: check.mts <taskId> <ladderId>")
const api = async (p: string) => (await fetch(`http://localhost:3500${p}`, { headers: { authorization: `Bearer ${process.env.API_TOKEN}` } })).json() as any
const s = await api(`/api/task/${taskId}`)
const { patch } = await api(`/api/task/${taskId}/diff`)
const work = path.join(process.env.TASKS_DIR ?? path.join(backend, ".tasks"), "gui-check", taskId.slice(0, 8))
rmSync(work, { recursive: true, force: true })
mkdirSync(path.dirname(work), { recursive: true })
execFileSync("git", ["clone", "-q", "--depth", "1", ...(item.gitSource ? ["--branch", item.gitRef ?? "main", `file://${item.gitSource}`] : [path.join(backend, ".tasks/eval-repos", item.fixture)]), work])
writeFileSync(path.join(work, "pw.patch"), patch)
const fails: string[] = []
try {
  execFileSync("git", ["apply", "--whitespace=nowarn", "pw.patch"], { cwd: work })
  for (const c of item.checks ?? []) {
    const read = (f: string) => (existsSync(path.join(work, f)) ? readFileSync(path.join(work, f), "utf8") : "")
    if (c.type === "contains" && !read(c.file).includes(c.pattern)) fails.push(`${c.file} lacks ${c.pattern}`)
    if (c.type === "containsAny" && !c.files.some((f: string) => read(f).includes(c.pattern))) fails.push(`none of ${c.files} contain ${c.pattern}`)
  }
} catch (e) {
  fails.push(`patch did not apply: ${(e as Error).message.slice(0, 200)}`)
}
const ledger = readFileSync(path.join(backend, ".spend/openai-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.taskId === taskId)
const by: Record<string, number> = {}
for (const r of ledger) by[r.purpose] = +((by[r.purpose] ?? 0) + r.costUsd).toFixed(4)
const out = { id: item.id, taskId, status: s.status, accept: fails.length ? "fail" : "pass", fails, judge: s.verdict ? `${s.verdict.success ? "✔" : "✘"} ${s.verdict.confidence}` : null, costUsd: +Number(s.costUsd).toFixed(4), calls: s.llmCalls, costByPurpose: by, files: (s.stats ?? []).map((f: any) => `${f.status} ${f.path} +${f.added}/-${f.removed}`), via: "gui", ts: new Date().toISOString() }
writeFileSync(path.join(backend, ".spend/eval-results.jsonl"), readFileSync(path.join(backend, ".spend/eval-results.jsonl"), "utf8") + JSON.stringify(out) + "\n")
console.log(JSON.stringify(out, null, 1))
