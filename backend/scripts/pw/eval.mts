/**
 * Pullwright eval harness (SWE-bench style, local, never publishes).
 *
 *   npx tsx --env-file=.env scripts/pw/eval.mts L01 L02 ...   # run selected ladder items
 *
 * For each item: materialise the fixture as a fresh git repo, create an operator eval task via the API,
 * wait for it to finish, then apply the patch to a clean copy and run the hidden acceptance test plus the
 * full suite inside a throwaway node:20 container. Results → .spend/eval-results.jsonl
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const backend = path.resolve(here, "../..")
const API = process.env.PW_API ?? "http://localhost:3500"
const TOKEN = process.env.API_TOKEN!
const DOCKER = process.env.DOCKER_BIN ?? "/Applications/Docker.app/Contents/Resources/bin/docker"
const tasksDir = process.env.TASKS_DIR ?? path.join(backend, ".tasks")
const evalRepos = process.env.EVAL_REPOS_DIR ?? path.join(tasksDir, "eval-repos")
const ladder = JSON.parse(readFileSync(path.join(backend, "evals/ladder.json"), "utf8")) as LadderItem[]

type LadderItem = {
  id: string
  level: number
  fixture: string
  title: string
  body: string
  expect?: "blocked"
  acceptance: { file: string; code: string } | null
  gitSource?: string
  gitRef?: string
  checks?: ({ type: "contains"; file: string; pattern: string } | { type: "onlyFiles"; files: string[] } | { type: "maxRemoved"; n: number } | { type: "containsAny"; files: string[]; pattern: string })[]
}

const sh = (cmd: string, args: string[], cwd?: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })

function materialise(fixture: string, gitSource?: string, gitRef?: string): string {
  const dir = path.join(evalRepos, fixture)
  if (existsSync(path.join(dir, ".git"))) return fixture
  if (gitSource) {
    mkdirSync(evalRepos, { recursive: true })
    sh("git", ["clone", "-q", "--depth", "1", "--branch", gitRef ?? "main", `file://${gitSource}`, dir])
    return fixture
  }
  mkdirSync(dir, { recursive: true })
  cpSync(path.join(backend, "evals/fixtures", fixture), dir, { recursive: true })
  sh("git", ["init", "-q", "-b", "main"], dir)
  sh("git", ["add", "-A"], dir)
  sh("git", ["-c", "user.name=eval", "-c", "user.email=eval@local", "commit", "-qm", "fixture"], dir)
  return fixture
}

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(API + p, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(j)}`)
  return j as Record<string, any>
}

const STOP = new Set(["ready", "needs_review", "failed", "cancelled", "needs_input", "awaiting_approval", "published"])

async function runItem(item: LadderItem) {
  const repo = materialise(item.fixture, item.gitSource, item.gitRef)
  const t0 = Date.now()
  const { taskId } = await api("POST", "/api/eval/task", { localRepo: repo, title: item.title, body: item.body, autoApprove: true })
  process.stdout.write(`\n▶ ${item.id} task=${taskId}\n`)
  let s: Record<string, any> = {}
  let last = ""
  while (true) {
    await new Promise((r) => setTimeout(r, 4000))
    s = await api("GET", `/api/task/${taskId}`)
    const line = `  ${s.status}${s.statusDetail ? " — " + String(s.statusDetail).slice(0, 90) : ""} · $${Number(s.costUsd).toFixed(4)} · ${s.llmCalls} calls`
    if (line !== last) console.log(line)
    last = line
    if (STOP.has(s.status)) break
    if (Date.now() - t0 > 25 * 60_000) {
      await api("POST", `/api/task/${taskId}/cancel`).catch(() => {})
      break
    }
  }
  const diff = await api("GET", `/api/task/${taskId}/diff`).catch(() => ({ patch: "" }))
  const patch = String(diff.patch ?? "")

  let accept: "pass" | "fail" | "n/a" = "n/a"
  let suite = "n/a"
  let acceptOut = ""
  if (item.acceptance && patch.trim()) {
    const work = path.join(tasksDir, "eval-check", `${item.id}-${taskId.slice(0, 8)}`)
    rmSync(work, { recursive: true, force: true })
    mkdirSync(path.dirname(work), { recursive: true })
    sh("git", ["clone", "-q", path.join(evalRepos, repo), work])
    writeFileSync(path.join(work, "pw.patch"), patch)
    try {
      sh("git", ["apply", "--whitespace=nowarn", "pw.patch"], work)
      rmSync(path.join(work, "pw.patch"))
      mkdirSync(path.dirname(path.join(work, item.acceptance.file)), { recursive: true })
      writeFileSync(path.join(work, item.acceptance.file), item.acceptance.code)
      const run = (cmd: string) => {
        try {
          return { ok: true, out: sh(DOCKER, ["run", "--rm", "--network", "none", "-v", `${work}:/w`, "-w", "/w", "node:20-alpine", "sh", "-c", cmd]) }
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string }
          return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` }
        }
      }
      const a = run(`node --test ${item.acceptance.file}`)
      accept = a.ok ? "pass" : "fail"
      acceptOut = a.out.split("\n").filter((l) => /not ok|✖|Error|expected|actual/.test(l)).slice(0, 12).join("\n")
      const full = run(`node --test 2>&1 | grep -E '^# (pass|fail)'`)
      suite = full.out.replace(/\n/g, " ").trim()
    } catch (e) {
      accept = "fail"
      acceptOut = `patch did not apply: ${(e as Error).message.slice(0, 300)}`
    }
  }
  // "blocked" means the agent stopped to ask instead of inventing code — no patch may be produced.
  if (item.checks && patch.trim()) {
    const work = path.join(tasksDir, "eval-check", `${item.id}-${taskId.slice(0, 8)}`)
    rmSync(work, { recursive: true, force: true })
    mkdirSync(path.dirname(work), { recursive: true })
    sh("git", ["clone", "-q", path.join(evalRepos, repo), work])
    writeFileSync(path.join(work, "pw.patch"), patch)
    const fails: string[] = []
    try {
      sh("git", ["apply", "--whitespace=nowarn", "pw.patch"], work)
      rmSync(path.join(work, "pw.patch"))
      const stats = (s.stats ?? []) as { path: string; removed: number }[]
      for (const c of item.checks) {
        if (c.type === "contains" && !readFileSync(path.join(work, c.file), "utf8").includes(c.pattern)) fails.push(`${c.file} lacks ${c.pattern}`)
        if (c.type === "onlyFiles") for (const f of stats) if (!c.files.includes(f.path)) fails.push(`unexpected file ${f.path}`)
        if (c.type === "containsAny" && !c.files.some((f) => existsSync(path.join(work, f)) && readFileSync(path.join(work, f), "utf8").includes(c.pattern))) fails.push(`none of ${c.files.join(", ")} contain ${c.pattern}`)
        if (c.type === "maxRemoved") for (const f of stats) if (f.removed > c.n) fails.push(`${f.path} removed ${f.removed} lines`)
      }
    } catch (e) {
      fails.push(`patch did not apply: ${(e as Error).message.slice(0, 200)}`)
    }
    accept = fails.length ? "fail" : "pass"
    acceptOut = fails.join("\n")
  }
  const blockedOk = item.expect === "blocked" ? !patch.trim() && (s.status === "needs_input" || /^Needs clarification/.test(String(s.failureReason ?? ""))) : null
  // Efficiency: per-phase spend and cache hits from the ledger; phase timings, bounces and review rounds from events.
  const ledgerRows = readFileSync(path.join(backend, ".spend/openai-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r: any) => r.taskId === taskId)
  const byPurpose: Record<string, number> = {}
  for (const r of ledgerRows) byPurpose[r.purpose] = +((byPurpose[r.purpose] ?? 0) + r.costUsd).toFixed(4)
  const inTok = ledgerRows.reduce((a: number, r: any) => a + r.inputTokens, 0)
  const cachedTok = ledgerRows.reduce((a: number, r: any) => a + r.cachedInputTokens, 0)
  const outTok = ledgerRows.reduce((a: number, r: any) => a + r.outputTokens, 0)
  const events = (await api("GET", `/api/task/${taskId}/events`).catch(() => [])) as any[]
  const firstAt = (st: string) => events.find((e) => e.type === "status" && e.status === st)?.timestamp
  const span = (a?: string, b?: string) => (a && b ? +((Date.parse(b) - Date.parse(a)) / 60000).toFixed(1) : null)
  const endAt = events[events.length - 1]?.timestamp
  const phases = {
    setupMin: span(firstAt("preparing"), firstAt("planning")),
    planMin: span(firstAt("planning"), firstAt("running")),
    runMin: span(firstAt("running"), firstAt("validating")),
    validateToEndMin: span(firstAt("validating"), endAt),
  }
  const gateBounces = events.filter((e) => e.type === "gate_result" && !e.ok).length
  const reviewRounds = events.filter((e) => e.type === "judge_result").length
  const toolFailures = events.filter((e) => e.type === "tool_result" && !e.success).length
  const stuck = events.filter((e) => e.type === "notice" && /Loop detected/.test(e.message ?? "")).length

  const result = {
    ts: new Date().toISOString(),
    id: item.id,
    level: item.level,
    taskId,
    status: s.status,
    reason: s.failureReason ?? s.statusDetail,
    costUsd: Number(s.costUsd),
    llmCalls: s.llmCalls,
    toolCalls: s.toolCalls,
    minutes: +((Date.now() - t0) / 60000).toFixed(1),
    files: (s.stats ?? []).map((f: any) => `${f.status} ${f.path} +${f.added}/-${f.removed}`),
    gateOk: s.gate?.ok ?? null,
    gateProblems: s.gate?.problems?.length ?? null,
    judge: s.verdict ? `${s.verdict.success ? "✔" : "✘"} ${s.verdict.confidence}` : null,
    accept,
    suite,
    blockedOk,
    costByPurpose: byPurpose,
    tokens: { in: inTok, cachedPct: inTok ? Math.round((100 * cachedTok) / inTok) : 0, out: outTok },
    phases,
    gateBounces,
    reviewRounds,
    toolFailures,
    stuck,
    stopReason: /Stopped early: (.*)/.exec(String(s.summary ?? ""))?.[1] ?? null,
  }
  appendFileSync(path.join(backend, ".spend/eval-results.jsonl"), JSON.stringify(result) + "\n")
  console.log(`  ⇒ ${result.status} | accept=${accept} | suite: ${suite} | judge=${result.judge} | $${result.costUsd.toFixed(4)} | ${result.minutes}m`)
  console.log(`    calls=${result.llmCalls} tools=${result.toolCalls} toolFail=${toolFailures} stuck=${stuck} gateBounces=${gateBounces} reviews=${reviewRounds} cached=${result.tokens.cachedPct}% cost=${JSON.stringify(byPurpose)} phases=${JSON.stringify(phases)}${result.stopReason ? " STOP=" + result.stopReason : ""}`)
  if (result.files.length) console.log(`    files: ${result.files.join(", ")}`)
  if (accept === "fail" && acceptOut) console.log(acceptOut.replace(/^/gm, "    ! "))
  if (item.expect === "blocked") console.log(`    blocked-as-expected: ${blockedOk}`)
  return result
}

const wanted = process.argv.slice(2)
const items = ladder.filter((i) => wanted.length === 0 || wanted.some((w) => i.id.startsWith(w)))
const budget = await api("GET", "/api/budget")
console.log(`Platform spend so far: $${Number(budget.platformSpentUsd).toFixed(4)} / hard stop $${budget.hardStopUsd}`)
for (const item of items) {
  const b = await api("GET", "/api/budget")
  if (Number(b.platformSpentUsd) > Number(b.hardStopUsd) - 0.15) {
    console.log("Stopping: too close to the spend hard stop.")
    break
  }
  await runItem(item)
}
const end = await api("GET", "/api/budget")
console.log(`\nPlatform spend now: $${Number(end.platformSpentUsd).toFixed(4)}`)
