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
import { chatVia, parseLanes } from "../../src/llm/lanes.js"
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
const baseLadder = JSON.parse(readFileSync(path.join(backend, "evals/ladder.json"), "utf8")) as LadderItem[]
// Vague and image variants of ladder items (evals/vague.json, evals/multimodal.json): their own title and
// body, the base item's fixture, hidden acceptance test and checks. Run them by id, e.g. `eval.mts V06 M05`.
const derived = ["vague.json", "multimodal.json"].flatMap((f) =>
  (JSON.parse(readFileSync(path.join(backend, "evals", f), "utf8")) as (Partial<LadderItem> & { id: string; base?: string; title: string; body: string })[]).map((d) => {
    // Either a variant of a ladder item (base: same fixture, hidden test and checks) or a full item of its own.
    const base = d.base ? baseLadder.find((l) => l.id === d.base) : undefined
    if (d.base && !base) throw new Error(`${f}: unknown base ${d.base}`)
    const { base: _b, ...own } = d
    return { level: 0, acceptance: null, ...(base ?? {}), ...own, ...(base ? { fullBody: base.body } : {}) } as LadderItem
  }),
)
const ladder = [...baseLadder, ...derived]

type LadderItem = {
  id: string
  level: number
  fixture: string
  title: string
  body: string
  expect?: "blocked"
  /** Variants (vague/image items): the base item's full issue text, which only the simulated user sees. */
  fullBody?: string
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
  const { taskId } = await api("POST", "/api/eval/task", { localRepo: repo, title: item.title, body: item.body, autoApprove: !SIM_USER, ...(MODEL ? { model: MODEL } : {}), ...(TRANSPORT ? { transport: TRANSPORT } : {}) })
  process.stdout.write(`\n▶ ${item.id} task=${taskId}\n`)
  let s: Record<string, any> = {}
  let last = ""
  const sim = { questions: 0, replans: 0, answers: [] as string[] }
  while (true) {
    await new Promise((r) => setTimeout(r, 4000))
    s = await api("GET", `/api/task/${taskId}`)
    const line = `  ${s.status}${s.statusDetail ? " — " + String(s.statusDetail).slice(0, 90) : ""} · $${Number(s.costUsd).toFixed(4)} · ${s.llmCalls} calls`
    if (line !== last) console.log(line)
    last = line
    if (SIM_USER && s.status === "needs_input" && s.pendingQuestion) {
      const a = await simAnswer(item, s.pendingQuestion)
      sim.questions++
      sim.answers.push(a)
      console.log(`  💬 asked: ${String(s.pendingQuestion).replace(/\s+/g, " ").slice(0, 160)}\n  👤 ${a.slice(0, 200)}`)
      await api("POST", `/api/task/${taskId}/message`, { text: a })
      continue
    }
    if (SIM_USER && s.status === "awaiting_approval" && s.plan) {
      const change = sim.replans < 1 ? await simReview(item, s.plan) : null // one review round, like a real user
      if (change) {
        sim.replans++
        console.log(`  👤 changed decisions → re-plan\n${change.replace(/^/gm, "     ")}`)
        await api("POST", `/api/task/${taskId}/replan`, { text: change })
      } else {
        console.log(`  👤 approved${s.plan.assumptions?.length ? ` (${s.plan.assumptions.length} decisions kept)` : ""}`)
        await api("POST", `/api/task/${taskId}/approve`, {})
      }
      continue
    }
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
  // Efficiency: per-purpose spend, cache hits and which model/provider ran each purpose — from the
  // API (llm_calls), so the harness works from any machine. Rows are written in batches: give a
  // separate worker's last batch a moment to land.
  await new Promise((r) => setTimeout(r, 4000))
  const ledgerRows = (await api("GET", `/api/task/${taskId}/calls`).catch(() => [])) as any[]
  const byPurpose: Record<string, number> = {}
  const lanes: Record<string, string[]> = {}
  for (const r of ledgerRows) {
    byPurpose[r.purpose] = +((byPurpose[r.purpose] ?? 0) + r.costUsd).toFixed(4)
    const lane = `${r.provider}/${r.model}`
    lanes[r.purpose] = [...new Set([...(lanes[r.purpose] ?? []), lane])]
  }
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
    model: MODEL ?? "default",
    ...(TAG ? { tag: TAG } : {}),
    ...(SIM_USER ? { sim } : {}),
    ...(TRANSPORT ? { transport: TRANSPORT } : {}),
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
    lanes,
    tokens: { in: inTok, cachedPct: inTok ? Math.round((100 * cachedTok) / inTok) : 0, out: outTok },
    phases,
    gateBounces,
    reviewRounds,
    toolFailures,
    stuck,
    stopReason: /Stopped early: (.*)/.exec(String(s.summary ?? ""))?.[1] ?? null,
  }
  // A task that died on exhausted quota is a campaign retry, not a measurement.
  const quotaDeath = CAMPAIGN && result.status === "failed" && /No model available right now/.test(String(result.reason ?? ""))
  if (!quotaDeath) appendFileSync(path.join(backend, ".spend/eval-results.jsonl"), JSON.stringify(result) + "\n")
  console.log(`  ⇒ [${result.model}] ${result.status} | accept=${accept} | suite: ${suite} | judge=${result.judge} | $${result.costUsd.toFixed(4)} | ${result.minutes}m`)
  console.log(`    calls=${result.llmCalls} tools=${result.toolCalls} toolFail=${toolFailures} stuck=${stuck} gateBounces=${gateBounces} reviews=${reviewRounds} cached=${result.tokens.cachedPct}% cost=${JSON.stringify(byPurpose)} lanes=${JSON.stringify(lanes)} phases=${JSON.stringify(phases)}${result.stopReason ? " STOP=" + result.stopReason : ""}`)
  if (result.files.length) console.log(`    files: ${result.files.join(", ")}`)
  if (accept === "fail" && acceptOut) console.log(acceptOut.replace(/^/gm, "    ! "))
  if (item.expect === "blocked") console.log(`    blocked-as-expected: ${blockedOk}`)
  return result
}

// --model <id> pins the plan/run model for a comparison run (e.g. gpt-5-nano, deepseek/deepseek-v4-flash-0731).
// --campaign: free-tier runs over several days — waits for daily resets instead of burning items on
//   exhausted quota (stops starting items when a role's lanes are all ≥ 90% used or cooling down, and
//   re-runs an item that failed with "No model available" once the lane is back).
// --tag <name>: label rows in eval-results.jsonl (e.g. free-v1) so runs can be compared.
const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv.splice(i, 2)[1] as string) : undefined
}
const MODEL = flag("--model")
const TAG = flag("--tag")
// --transport direct|unpaced: per-task transport for interleaved A/B runs (see TaskOptions.transport).
const TRANSPORT = flag("--transport")
const ci = argv.indexOf("--campaign")
const CAMPAIGN = ci >= 0
if (CAMPAIGN) argv.splice(ci, 1)
// --simulated-user: plans are not auto-approved. A cheap model that holds the item's FULL issue text (the
// vague variant hides it from the agent) answers clarification questions and reviews the plan's
// decisions at approval, changing the ones that contradict the full issue — the Ambig-SWE / Ask-or-Assume
// protocol. It may also say "I don't know".
const si = argv.indexOf("--simulated-user")
const SIM_USER = si >= 0
if (SIM_USER) argv.splice(si, 1)
const simLane = parseLanes(process.env.PW_SIM_USER_LANE ?? "vercel:openai/gpt-5-mini", "low")
const simChat = SIM_USER ? chatVia(simLane) : null
const SIM_SYSTEM = `You are the developer who filed a GitHub issue. You know exactly what you want (the FULL issue below); the coding agent only saw a short version. Answer its questions the way a busy but helpful developer would: short, concrete, only what the full issue supports. If the full issue does not settle something, say "I don't have a preference" for that point. Never paste the full issue or mention that it exists. Reply with a JSON object only.`

async function simAnswer(item: LadderItem, question: string): Promise<string> {
  const res = await simChat!({
    taskId: "sim-user", purpose: "sim_user", jsonMode: true, maxOutputTokens: 800,
    messages: [
      { role: "system", content: SIM_SYSTEM },
      { role: "user", content: `FULL issue:\n${item.title}\n${item.fullBody ?? item.body}\n\nThe agent asks:\n${question}\n\nReply {"answer": "..."}` },
    ],
  })
  return (JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}").answer as string) || "I don't have a preference."
}

/** Review the plan's decisions against the full issue: null = approve as is, else the re-plan text. */
async function simReview(item: LadderItem, plan: { assumptions?: { question: string; chosen: string; alternatives: string[] }[]; requirements?: string[] }): Promise<string | null> {
  const dec = plan.assumptions ?? []
  if (!dec.length) return null
  const res = await simChat!({
    taskId: "sim-user", purpose: "sim_user", jsonMode: true, maxOutputTokens: 1200,
    messages: [
      { role: "system", content: SIM_SYSTEM },
      { role: "user", content: `FULL issue:\n${item.title}\n${item.fullBody ?? item.body}\n\nThe agent's plan made these decisions (chosen → alternatives):\n${dec.map((a, i) => `${i + 1}. ${a.question}\n   chosen: ${a.chosen}\n   alternatives: ${a.alternatives.join(" | ") || "(none)"}`).join("\n")}\n\nFor each decision say whether the chosen option matches what the full issue wants. Reply {"decisions": [{"n": 1, "ok": true} | {"n": 2, "ok": false, "want": "<what it should be, concretely>"}]}` },
    ],
  })
  const j = JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { decisions?: { n: number; ok: boolean; want?: string }[] }
  const changes = (j.decisions ?? []).filter((d) => !d.ok && d.want && dec[d.n - 1])
  if (!changes.length) return null
  return ["Decisions for this plan (final — plan around these):", ...dec.map((a, i) => `- ${a.question} → ${changes.find((c) => c.n === i + 1)?.want ?? a.chosen}`)].join("\n")
}
const wanted = argv

type QuotaRow = { lane: string; rpd: { used: number; limit: number | null }; cooldownMs: number; dayResetAt: string }
/** When the free lanes of some role can't take another task, the time to wait until; otherwise null. */
async function campaignWait(): Promise<{ until: number; why: string } | null> {
  const q = (await api("GET", "/api/quota").catch(() => ({}))) as Record<string, QuotaRow[]>
  let worst: { until: number; why: string } | null = null
  for (const role of ["plan", "run", "judge"]) {
    const lanes = q[role] ?? []
    if (!lanes.length) continue
    const free = lanes.filter((l) => l.rpd.limit !== null || l.cooldownMs > 0)
    if (free.length !== lanes.length) continue // a lane without a daily cap can always take the task
    const blocked = lanes.map((l) => {
      if (l.rpd.limit !== null && l.rpd.used >= 0.9 * l.rpd.limit) return Date.parse(l.dayResetAt)
      if (l.cooldownMs > 60_000) return Date.now() + l.cooldownMs
      return null
    })
    if (blocked.every((b) => b !== null)) {
      const until = Math.min(...(blocked as number[]))
      if (!worst || until > worst.until) worst = { until, why: `${role}: ${lanes.map((l) => `${l.lane} ${l.rpd.used}/${l.rpd.limit ?? "∞"}`).join(", ")}` }
    }
  }
  return worst
}
const sleepUntil = async (t: number, why: string) => {
  const ms = Math.max(0, t - Date.now()) + 30_000
  console.log(`⏸ campaign: waiting ${(ms / 60000).toFixed(0)} min (${why}) → resumes ${new Date(Date.now() + ms).toISOString()}`)
  await new Promise((r) => setTimeout(r, ms))
}
// With no ids, only the base ladder runs (variants are opt-in).
const items = wanted.length === 0 ? baseLadder : ladder.filter((i) => wanted.some((w) => i.id.startsWith(w)))
const budget = await api("GET", "/api/budget")
console.log(`Platform spend so far: $${Number(budget.platformSpentUsd).toFixed(4)} / hard stop $${budget.hardStopUsd}`)
for (const item of items) {
  const b = await api("GET", "/api/budget")
  if (Number(b.platformSpentUsd) > Number(b.hardStopUsd) - 0.15) {
    console.log("Stopping: too close to the spend hard stop.")
    break
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (CAMPAIGN) {
      const w = await campaignWait()
      if (w) await sleepUntil(w.until, w.why)
    }
    const r = await runItem(item)
    const m = /No model available right now \(next available ([^)]+)\)/.exec(String(r.reason ?? ""))
    if (!(CAMPAIGN && r.status === "failed" && m)) break
    console.log(`  ↻ quota exhausted mid-task; not counted. Retrying after the reset (attempt ${attempt}/3).`)
    await sleepUntil(Date.parse(m[1]!), "lane exhausted mid-task")
  }
}
const end = await api("GET", "/api/budget")
console.log(`\nPlatform spend now: $${Number(end.platformSpentUsd).toFixed(4)}`)
