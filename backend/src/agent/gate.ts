import { rm } from "fs/promises"
import path from "path"
import { git, diffStat, type FileStat } from "./git.js"
import { newSyntaxErrors } from "./tools/syntax.js"
import type { Workspace } from "./workspace.js"
import type { Sandbox } from "./sandbox.js"
import { truncateOutput } from "./sandbox.js"

/**
 * Deterministic pre-PR gate (no LLM). A change only reaches review/publish if:
 *   - the diff is non-empty and not whitespace-only
 *   - no file is gutted (large deletions) unless the plan says so
 *   - no lockfiles / build artefacts / env files / dependency edits unless planned
 *   - no new syntax errors in any changed file
 *   - verification commands that passed on the base commit still pass
 */

export type VerifyRun = { cmd: string; exitCode: number; output: string; durationMs: number; failures: string[] }

/** Failing test names from common reporters (node:test TAP/spec, vitest/jest, pytest, mocha). */
export function parseFailures(output: string): string[] {
  const out = new Set<string>()
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "")
  for (const line of clean.split("\n")) {
    let m = line.match(/^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/)
    if (!m) m = line.match(/^\s*✖ (.+?) \(\d[\d.]*m?s\)\s*$/)
    if (!m) m = line.match(/^\s*(?:×|✕|✗)\s+(.+?)(?:\s+\d+\s?ms)?\s*$/)
    if (!m) m = line.match(/^\s*FAIL\s+(\S.*?)\s*$/)
    if (!m) m = line.match(/^FAILED\s+(\S+)/)
    if (m?.[1] && !/^failing tests:?$/i.test(m[1].trim())) out.add(m[1].trim())
  }
  return [...out]
}
export type GateResult = {
  ok: boolean
  problems: string[]
  warnings: string[]
  /** Other places that use routes/APIs this change modified (impact analysis). */
  impact?: string[]
  stats: FileStat[]
  verify: { cmd: string; before: number | null; after: number; output: string; newFailures: string[]; fixed: string[] }[]
}

const ARTEFACT = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]+\.tsbuildinfo|[^/]+\.log|\.env(\.[^/]*)?|\.DS_Store)$|(^|\/)(node_modules|dist|build|coverage|\.next)\//
const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/
const ASSERTION = /\b(assert\w*|expect|should)\s*[.(]|^\s*[-+]?\s*(it|test)\s*\(/
const LEFTOVER = /\.(tmp|temp|log|db|sqlite3?|bak|swp)$|(^|\/)(tmp|temp)[^/]*\.(json|txt|csv)$|(^|\/)(__tests__|tests?|fixtures?)\/[^/]*\.(json|txt|csv|db)$/i
const SCRATCH = /(^|\/)(scratch|tmp|temp|debug|repro|reproduce|test_repro|try)[^/]*\.(js|ts|mjs|cjs|py|sh)$/i

export async function runVerify(sb: Sandbox, cmds: string[], timeoutMs = 300_000): Promise<VerifyRun[]> {
  const out: VerifyRun[] = []
  for (const cmd of cmds) {
    const r = await sb.exec(cmd, timeoutMs)
    out.push({ cmd, exitCode: r.timedOut ? 124 : r.exitCode, output: truncateOutput(r.stdout, 4_000), durationMs: r.durationMs, failures: parseFailures(r.stdout) })
  }
  return out
}

/**
 * Build/test runs leave artefacts behind (logs, tsbuildinfo, lockfile rewrites, coverage). Those are
 * not the agent's change: restore tracked ones from the base commit and delete new ones, deterministically.
 */
export async function revertSideEffects(root: string, baseSha: string, planned: string[]): Promise<string[]> {
  const plannedSet = new Set(planned)
  const stats = await diffStat(root, baseSha)
  const reverted: string[] = []
  for (const s of stats) {
    if (!ARTEFACT.test(s.path) || plannedSet.has(s.path)) continue
    if (s.status === "A") await git(root, ["rm", "-q", "-f", "--cached", "--", s.path]).then(() => rm(path.join(root, s.path), { force: true }))
    else await git(root, ["checkout", baseSha, "--", s.path])
    reverted.push(s.path)
  }
  if (reverted.length) await git(root, ["reset", "-q"])
  return reverted
}

export async function runGate(input: {
  ws: Workspace
  sb: Sandbox
  baseSha: string
  plannedFiles: string[]
  planText: string
  verifyCmds: string[]
  baseline: VerifyRun[]
  /** Unplanned files already flagged once; a second finish with them is accepted as a warning. */
  unplannedSeen?: Set<string>
  /** Impact findings already surfaced once. */
  impactSeen?: Set<string>
  /** Plan steps (to point at the step that mentions an untouched planned file). */
  planSteps?: { title: string; files: string[] }[]
  /** Planned-but-untouched files already surfaced once. */
  untouchedSeen?: Set<string>
}): Promise<GateResult> {
  const { ws, baseSha } = input
  const problems: string[] = []
  const warnings: string[] = []
  // Run verification first (it may write artefacts), then clean side effects, then inspect the diff.
  const after = await runVerify(input.sb, input.verifyCmds)
  const verifyRed = async () =>
    after.some((a) => {
      const b = input.baseline.find((x) => x.cmd === a.cmd)
      return a.exitCode !== 0 && (!b || b.exitCode === 0 || a.failures.some((f) => !b.failures.includes(f)))
    })
  let probes = 0
  const neededForBuild = async (f: FileStat): Promise<boolean> => {
    if (!input.verifyCmds.length || f.status !== "M") return false
    if (++probes > 2) return true // bounded cost: assume later unplanned files are plumbing
    const current = await ws.read(f.path).catch(() => null)
    const original = await git(ws.root, ["show", `${baseSha}:${f.path}`]).catch(() => null)
    if (current === null || original === null) return false
    // Only the type-check for this file's own package (e.g. "cd frontend && npx tsc -b" for frontend/…).
    const fastAll = input.verifyCmds.filter((c) => /tsc|type-?check|build|compile|mypy|go vet/.test(c))
    const pkg = fastAll.filter((c) => {
      const dir = /^cd (\S+) &&/.exec(c)?.[1]
      return dir ? f.path.startsWith(dir.replace(/\/$/, "") + "/") : true
    })
    const fast = pkg.length ? pkg : fastAll
    try {
      await ws.write(f.path, original)
      const probe = await runVerify(input.sb, fast.length ? fast : input.verifyCmds, 180_000)
      return probe.some((p) => {
        const now = after.find((a) => a.cmd === p.cmd)
        return p.exitCode !== 0 && (!now || now.exitCode === 0 || p.failures.some((x) => !now.failures.includes(x)))
      })
    } finally {
      await ws.write(f.path, current)
    }
  }
  const reverted = await revertSideEffects(ws.root, baseSha, input.plannedFiles)
  if (reverted.length) warnings.push(`Auto-reverted build/test side effects: ${reverted.join(", ")}`)
  const stats = await diffStat(ws.root, baseSha)
  const planned = new Set(input.plannedFiles)
  const allowRewrite = /\b(rewrite|replace|remove|delete|drop|strip|rename|move)\b/i.test(input.planText)

  if (stats.length === 0) {
    problems.push("The diff is empty — no files were changed. Implement the change before calling finish.")
    return { ok: false, problems, warnings, stats, verify: [] }
  }
  const ignoringWs = (await git(ws.root, ["diff", "--cached", "-w", "--ignore-blank-lines", "--stat", baseSha])).trim()
  if (!ignoringWs) problems.push("The diff only changes whitespace/blank lines. Make the actual change.")

  for (const s of stats) {
    if (ARTEFACT.test(s.path) && !planned.has(s.path)) {
      problems.push(`${s.path} is a lockfile/build artefact/env file and should not be in this change. Undo your edit to it.`)
    }
    // Test-run leftovers: data/temp files created by running code (often under test/), or odd paths like "file:/…".
    if (s.status === "A" && !planned.has(s.path) && (LEFTOVER.test(s.path) || s.path.includes(":"))) {
      problems.push(`${s.path} looks like a file generated while running code (temp/data/log output). Delete it and make tests write to a temporary directory (os.tmpdir()).`)
    }
    if (SCRATCH.test(s.path) && s.status === "A" && !planned.has(s.path)) {
      problems.push(`${s.path} looks like a scratch/debug file. Delete it before finishing.`)
    }
    if (s.status === "M" && !allowRewrite) {
      const before = await git(ws.root, ["show", `${baseSha}:${s.path}`]).catch(() => "")
      const origLines = before.split("\n").length
      if (s.removed >= 30 && s.removed > origLines * 0.4 && s.added < s.removed * 0.6) {
        problems.push(
          `${s.path}: ${s.removed} of ${origLines} lines were removed (only ${s.added} added). This looks like the file was truncated or rewritten. Restore the removed code and make a targeted edit.`,
        )
      }
    }
    // Weakening the test suite to get green is never acceptable: net removal of assertions blocks.
    if (s.status !== "A" && TEST_FILE.test(s.path)) {
      const d = await git(ws.root, ["diff", "--cached", baseSha, "--", s.path])
      const removedAsserts = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---") && ASSERTION.test(l)).length
      const addedAsserts = d.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++") && ASSERTION.test(l)).length
      if (removedAsserts > addedAsserts || (s.status === "D" && removedAsserts > 0)) {
        problems.push(
          `${s.path}: ${removedAsserts - addedAsserts} existing test assertion(s) were removed. Never delete or weaken existing tests to make the suite pass — restore them. Pre-existing failures that this issue doesn't cover can stay failing.`,
        )
      }
    }
    if (s.status === "D" && !planned.has(s.path) && !allowRewrite) {
      problems.push(`${s.path} was deleted but the plan does not mention deleting it. Restore it.`)
    }
    if (/(^|\/)package\.json$/.test(s.path) && !planned.has(s.path)) {
      const d = await git(ws.root, ["diff", "--cached", baseSha, "--", s.path])
      if (/^[+-]\s*"[^"]+":\s*"[\^~]?\d/m.test(d)) problems.push(`${s.path}: dependency versions changed but the plan does not include dependency changes. Revert those lines.`)
    }
    // Call sites the impact check itself asked the agent to update are in scope, not scope creep.
    const requestedByGate = [...(input.impactSeen ?? [])].some((h) => h.startsWith(s.path + ":"))
    if (!planned.has(s.path) && !requestedByGate && !/(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[a-z]+$/.test(s.path) && s.status !== "D") {
      // Unplanned edits are often plumbing the build needs (type unions, exhaustive maps). Test it:
      // temporarily revert the file and re-run verification — only flag it if nothing breaks.
      if (input.unplannedSeen && !input.unplannedSeen.has(s.path) && !(await verifyRed()) && !(await neededForBuild(s))) {
        input.unplannedSeen.add(s.path)
        problems.push(
          `${s.path} is not part of the approved plan. Revert your changes to it (restore the original lines exactly) unless this issue cannot be resolved without it — if it truly is required, keep it and explain why in your finish summary.`,
        )
      } else warnings.push(`${s.path} was changed but is not in the approved plan.`)
    }
    if (s.status !== "D") {
      const before = s.status === "A" ? null : await git(ws.root, ["show", `${baseSha}:${s.path}`]).catch(() => null)
      const after = await ws.read(s.path).catch(() => null)
      if (after !== null) {
        const errs = newSyntaxErrors(s.path, before, after)
        if (errs.length) problems.push(`${s.path} has syntax errors: ${errs.slice(0, 3).map((e) => `line ${e.line}: ${e.message}`).join("; ")}`)
      }
    }
  }

  // Verification commands: only regressions block — a command that passed now fails, or
  // (for suites that were already red) tests that newly fail. Pre-existing failures are warnings.
  const verify = after.map((a) => {
    const b = input.baseline.find((x) => x.cmd === a.cmd)
    const before = new Set(b?.failures ?? [])
    const now = new Set(a.failures)
    return {
      cmd: a.cmd,
      before: b ? b.exitCode : null,
      after: a.exitCode,
      output: a.output,
      newFailures: [...now].filter((f) => !before.has(f)),
      fixed: [...before].filter((f) => !now.has(f)),
    }
  })
  for (const v of verify) {
    if (v.after === 0) continue
    if (v.before === 0 || v.before === null) {
      problems.push(`\`${v.cmd}\` ${v.before === 0 ? "passed before your change but now fails" : "fails"} (exit ${v.after}):\n${truncateOutput(v.output, 2_500)}`)
    } else if (v.newFailures.length) {
      problems.push(`\`${v.cmd}\`: your change broke tests that passed before: ${v.newFailures.slice(0, 8).join("; ")}\n${truncateOutput(v.output, 2_000)}`)
    } else {
      warnings.push(`\`${v.cmd}\` was already failing before this change (exit ${v.before}) and still fails${v.fixed.length ? ` (fixed: ${v.fixed.join("; ")})` : ""}.`)
    }
  }

  // Plan completion: every file the approved plan said it would change must be touched (once-only nudge).
  const touched = new Set(stats.map((x) => x.path))
  const untouched = input.plannedFiles.filter((f) => !touched.has(f) && !input.untouchedSeen?.has(f) && !/\.(md|txt)$/.test(f))
  if (untouched.length && input.untouchedSeen) {
    untouched.forEach((f) => input.untouchedSeen!.add(f))
    const lines = untouched.map((f) => {
      const i = input.planSteps?.findIndex((st) => st.files.includes(f)) ?? -1
      return `  - ${f}${i >= 0 ? ` (step ${i + 1}: ${input.planSteps![i]!.title})` : ""}`
    })
    problems.push(
      `The approved plan changes these files, but they were not modified:\n${lines.join("\n")}\nImplement those steps now. If a step turned out to be unnecessary, say why in your finish summary and call finish again.`,
    )
  }

  // Impact analysis: consumers of HTTP routes this change touched, outside the diff.
  const impact = await routeConsumers(ws, baseSha, stats)
  const freshImpact = impact.filter((h) => !input.impactSeen?.has(h))
  if (freshImpact.length) {
    freshImpact.forEach((h) => input.impactSeen?.add(h))
    problems.push(
      `You changed HTTP route handlers that other code calls, and these call sites were not updated:\n${freshImpact.map((h) => `  - ${h}`).join("\n")}\n` +
        `Check whether they still work with your change (e.g. a new response shape). Update them if needed; if they genuinely need no change, call finish again.`,
    )
  } else if (impact.length) warnings.push(`Other code calls the changed routes (reviewed): ${impact.slice(0, 5).join("; ")}`)

  return { ok: problems.length === 0, problems, warnings, stats, verify, impact }
}

export function gateFeedback(g: GateResult): string {
  return (
    `The platform validated your change and found problems. Fix them, then call finish again.\n\n` +
    g.problems.map((p, i) => `${i + 1}. ${p}`).join("\n\n") +
    (g.warnings.length ? `\n\nWarnings (fix if they are mistakes):\n- ${g.warnings.join("\n- ")}` : "")
  )
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rb|java|kt|swift|dart)$/
const CALL_LIKE = /\b(fetch|axios|request|http|get|post|put|patch|delete|useQuery|useSWR|url|endpoint|api)\b|\$\{/i
const ROUTE_RE = /\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]+)["'`]/
/** Lines that define what callers see: the success response or the inputs the route reads. */
const CONTRACT = /\bres\.(json|send)\(|\bres\.status\(\s*2\d\d\s*\)|\breturn\s+\{|\breq\.(body|query)\b/
/** New error responses (validation, 4xx/5xx) don't change the contract for existing callers. */
const ERROR_RESPONSE = /status\(\s*[45]\d\d|\{\s*error\b|\berror:/

/** Find call sites of routes whose handlers were modified, in files the diff did not touch. */
export async function routeConsumers(ws: Workspace, baseSha: string, stats: FileStat[]): Promise<string[]> {
  const changed = new Set(stats.map((s) => s.path))
  const routes = new Set<string>()
  for (const s of stats) {
    if (s.status !== "M" || !/\.(ts|js|mjs|cjs)$/.test(s.path)) continue
    const d = await git(ws.root, ["diff", "--cached", "-U12", baseSha, "--", s.path]).catch(() => "")
    // A hunk that touches lines near a route registration counts as a change to that route.
    // Attribute each changed line to the nearest route registration above it (within the hunk context).
    for (const hunk of d.split(/^@@/m).slice(1)) {
      let current: string | null = null
      for (const line of hunk.split("\n").slice(1)) {
        const m = line.match(ROUTE_RE)
        if (m?.[2] && m[2].length > 1 && !m[2].includes(":")) current = m[2]
        if (/^[+-](?![+-])/.test(line) && current && CONTRACT.test(line) && !ERROR_RESPONSE.test(line)) routes.add(current)
      }
    }
  }
  const hits: string[] = []
  for (const r of [...routes].slice(0, 6)) {
    const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = `(api${escaped}|["'\`]${escaped})([?"'\`/]|$)`
    const out = await git(ws.root, ["grep", "-n", "-I", "-E", "-e", pattern, "--", "."]).catch(() => "")
    for (const line of out.split("\n").filter(Boolean)) {
      const file = line.slice(0, line.indexOf(":"))
      if (changed.has(file) || /(^|\/)(test|tests|__tests__|evals?|fixtures?)\/|\.test\.|\.spec\.|\.eval\./.test(file)) continue
      if (!CODE_FILE.test(file)) continue // docs, JSON fixtures, issue text
      const code = line.slice(line.indexOf(":", file.length + 1) + 1)
      if (ROUTE_RE.test(code)) continue // another route registration, not a consumer
      if (/\bcurl\s|\\`|^\s*(\/\/|\*|#)/.test(code)) continue // prose, markdown, comments
      if (!CALL_LIKE.test(code)) continue
      hits.push(line.length > 180 ? line.slice(0, 180) + "…" : line)
    }
  }
  // Application code first (src/, frontend/, app/), scripts last.
  const rank = (h: string) => (/(^|\/)(src|app|frontend|client|web)\//.test(h) ? 0 : /(^|\/)scripts?\//.test(h) ? 2 : 1)
  return hits.sort((a, b) => rank(a) - rank(b)).slice(0, 10)
}
