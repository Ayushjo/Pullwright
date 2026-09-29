import { execFile } from "child_process"
import { promisify } from "util"
import { readdir } from "fs/promises"
import path from "path"
import type { ToolDef } from "../llm.js"
import type { Workspace } from "../workspace.js"
import { PathError } from "../workspace.js"
import type { Sandbox } from "../sandbox.js"
import { truncateOutput } from "../sandbox.js"
import { Editor, type ToolOutput } from "./editor.js"
import { parseFailures } from "../gate.js"
import { tsErrorHints } from "../tsNotes.js"

const execFileP = promisify(execFile)

export type Control =
  | { control: "finish"; summary: string }
  | { control: "submit_plan"; plan: SubmittedPlan }
  | { control: "ask_user"; question: string }

export type Assumption = {
  question: string
  chosen: string
  alternatives: string[]
  /** file:line, "issue text", or "no evidence — default". */
  evidence: string
  impact: "blocking" | "behavior" | "cosmetic"
}

export type SubmittedPlan = {
  summary: string
  requirements: string[]
  steps: { title: string; files: string[] }[]
  files: { path: string; new: boolean }[]
  /** Choices the planner made where the issue left room (docs/architecture/intake.md §13.3). */
  assumptions?: Assumption[]
  /** Size from classifyTier (tier.ts). */
  tier?: "S" | "M" | "L"
  tierReason?: string
  risks?: string
  blocked?: string
  /** Set when the user edited steps/requirements at approval time — they override the summary. */
  editedByUser?: boolean
  userNotes?: string[]
}

export type ToolResult = ToolOutput | Control
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>
export type Tool = { def: ToolDef; handler: ToolHandler; mutates?: boolean }

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
})

const str = (description: string) => ({ type: "string", description })
const int = (description: string) => ({ type: "integer", description })

function argStr(a: Record<string, unknown>, k: string, required = true): string {
  const v = a[k]
  if (typeof v === "string") return v
  if (v === undefined || v === null) {
    if (required) throw new ArgError(`Missing required argument "${k}"`)
    return ""
  }
  return String(v)
}
function argInt(a: Record<string, unknown>, k: string): number | undefined {
  const v = a[k]
  if (v === undefined || v === null || v === "") return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) throw new ArgError(`Argument "${k}" must be an integer`)
  return Math.trunc(n)
}
export class ArgError extends Error {}

/**
 * `blocked` stops the task for a human, so only a real question counts. Small models sometimes fill it
 * with a non-answer ("No blocking issues identified…; however …"); that text moves to `risks` instead.
 */
export function parseAssumptions(raw: unknown): { assumptions?: Assumption[] } {
  if (!Array.isArray(raw)) return {}
  const out: Assumption[] = []
  for (const x of raw.slice(0, 8)) {
    if (!x || typeof x !== "object") continue
    const o = x as Record<string, unknown>
    const question = String(o.question ?? "").trim()
    const chosen = String(o.chosen ?? "").trim()
    if (!question || !chosen) continue
    out.push({
      question: question.slice(0, 300),
      chosen: chosen.slice(0, 300),
      alternatives: (Array.isArray(o.alternatives) ? o.alternatives : []).map((v) => String(v).trim()).filter(Boolean).slice(0, 3).map((v) => v.slice(0, 200)),
      evidence: String(o.evidence ?? "").trim().slice(0, 200) || "no evidence — default",
      impact: o.impact === "cosmetic" ? "cosmetic" : "behavior",
    })
  }
  return out.length ? { assumptions: out } : {}
}

export function splitBlocked(risks: unknown, blocked: unknown): { risks?: string; blocked?: string } {
  const r = typeof risks === "string" ? risks.trim() : ""
  const b = typeof blocked === "string" ? blocked.trim() : ""
  const notABlock = /^(none|n\/?a|no\b|nothing|not blocked|empty)/i.test(b)
  const outRisks = notABlock ? [r, b].filter(Boolean).join("\n") : r
  return { ...(outRisks ? { risks: outRisks } : {}), ...(b && !notABlock ? { blocked: b } : {}) }
}

// ── read-only tools ──────────────────────────────────────────────────────────

const SKIP_LIST = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", "__pycache__", ".venv", "target"])

async function listDir(ws: Workspace, p: string, depth: number): Promise<ToolOutput> {
  try {
    const rel = ws.rel(p || ".")
    if (!ws.exists(rel || ".")) return { ok: false, output: `Directory ${p} does not exist.` }
    if (!ws.isDir(rel || ".")) return { ok: false, output: `${rel} is a file. Use view.` }
    const out: string[] = []
    const walk = async (dir: string, d: number, prefix: string) => {
      const entries = (await readdir(path.join(ws.root, dir), { withFileTypes: true })).sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      )
      for (const e of entries) {
        if (out.length > 400) return
        if (e.isDirectory()) {
          if (SKIP_LIST.has(e.name)) {
            out.push(`${prefix}${e.name}/ (skipped)`)
            continue
          }
          out.push(`${prefix}${e.name}/`)
          if (d < depth) await walk(path.posix.join(dir, e.name), d + 1, prefix + "  ")
        } else out.push(`${prefix}${e.name}`)
      }
    }
    await walk(rel, 1, "")
    return { ok: true, output: truncateOutput(out.join("\n") || "(empty)", 12_000) }
  } catch (err) {
    return { ok: false, output: err instanceof PathError ? err.message : `list_dir failed: ${(err as Error).message}` }
  }
}

/** Two-level search (SWE-agent): too many hits → per-file counts; otherwise matching lines. */
async function search(ws: Workspace, pattern: string, p: string, glob: string): Promise<ToolOutput> {
  try {
    const rel = ws.rel(p || ".")
    const pathspec = glob
      ? `:(glob)${rel ? rel + "/" : ""}${glob.includes("/") ? glob : "**/" + glob}`
      : rel || "."
    const run = async (mode: "-E" | "-F") => {
      const args = ["grep", "--untracked", "-n", "-I", mode, "--no-color", "-e", pattern, "--", pathspec]
      return (await execFileP("git", args, { cwd: ws.root, maxBuffer: 16 * 1024 * 1024 })).stdout
    }
    let stdout = ""
    let literal = false
    try {
      stdout = await run("-E")
    } catch (err) {
      const e = err as { code?: number; stderr?: string }
      if (e.code === 1) return { ok: true, output: `No matches for /${pattern}/${rel ? " in " + rel : ""}.` }
      // Invalid regex (e.g. unbalanced "(") → search the text literally instead of failing.
      try {
        literal = true
        stdout = await run("-F")
      } catch (err2) {
        const e2 = err2 as { code?: number; stderr?: string }
        if (e2.code === 1) return { ok: true, output: `No matches for "${pattern}" (searched literally)${rel ? " in " + rel : ""}.` }
        return { ok: false, output: `search failed: ${e2.stderr?.trim() || "invalid pattern"}` }
      }
    }
    const lines = stdout.split("\n").filter(Boolean).filter((l) => !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml):/.test(l))
    if (lines.length > 60) {
      const counts = new Map<string, number>()
      for (const l of lines) {
        const f = l.slice(0, l.indexOf(":"))
        counts.set(f, (counts.get(f) ?? 0) + 1)
      }
      const files = [...counts.entries()].sort((a, b) => b[1] - a[1])
      if (files.length > 100) return { ok: true, output: `${lines.length} matches in ${files.length} files — too broad. Narrow the pattern or pass a path/glob.` }
      return { ok: true, output: `${lines.length} matches in ${files.length} files (search inside one file to see lines):\n${files.map(([f, n]) => `${f}: ${n}`).join("\n")}` }
    }
    return { ok: true, output: (literal ? "(pattern was not a valid regex — searched literally)\n" : "") + lines.map((l) => (l.length > 300 ? l.slice(0, 300) + "…" : l)).join("\n") }
  } catch (err) {
    return { ok: false, output: err instanceof PathError ? err.message : `search failed: ${(err as Error).message}` }
  }
}

// ── shell guard (cline command-guard, simplified) ────────────────────────────

const ALWAYS_BLOCKED: [RegExp, string][] = [
  [/\bgit\s+(commit|push|checkout|switch|reset|rebase|merge|stash|clean|remote|config|tag)\b/, "Git state is managed by the platform. Just edit files; they are committed for you."],
  [/\b(npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve|watch)\b|\bnodemon\b|\bvite(\s|$)(?!build)|\bnext\s+dev\b/, "Long-running servers are not allowed. Run tests/builds instead, or node -e for a quick check."],
  [/\b(sudo|su)\b|\brm\s+-rf\s+\/(\s|$)|\bshutdown\b|\breboot\b/, "Not allowed in the sandbox."],
  [/\b(curl|wget)\b.*\|\s*(sh|bash)/, "Piping remote scripts into a shell is not allowed."],
  [/\b(vim|vi|nano|less|more|top|htop)\b/, "Interactive programs are not available. Use view / search / str_replace."],
]
const PLAN_MODE_BLOCKED: [RegExp, string][] = [
  [/(^|[^<>&0-9])>{1,2}\s*(?!\/dev\/null|\/tmp\/)[^\s&]/, "Redirecting output into files is not allowed in PLAN mode."],
  [/\b(sed|perl)\s+(-[a-z]*i|--in-place)/, "In-place edits are not allowed in PLAN mode."],
  [/\b(rm|mv|cp|mkdir|touch|chmod|tee)\s/, "File modifications are not allowed in PLAN mode — describe the change in your plan instead."],
  [/\b(npm|pnpm|yarn)\s+(install|i|add|remove|uninstall|ci)\b|\bpip\s+install\b/, "Dependency changes are not allowed in PLAN mode."],
]

function guard(cmd: string, planMode: boolean): string | null {
  for (const [re, msg] of ALWAYS_BLOCKED) if (re.test(cmd)) return msg
  if (planMode) for (const [re, msg] of PLAN_MODE_BLOCKED) if (re.test(cmd)) return msg
  return null
}

export type Baseline = { cmd: string; exitCode: number; failures: string[] }[]

/** Tell the agent which failing tests were already failing before its change, so it doesn't chase them. */
function annotateFailures(output: string, baseline: Baseline | undefined): string {
  if (!baseline?.length) return ""
  const known = new Set(baseline.flatMap((b) => b.failures))
  if (!known.size) return ""
  const now = parseFailures(output)
  if (!now.length) return ""
  const old = now.filter((f) => known.has(f))
  const fresh = now.filter((f) => !known.has(f))
  return (
    `\n[platform note] ${old.length} failing test(s) were already failing before your change (not your job to fix): ${old.slice(0, 5).join("; ") || "none"}.` +
    (fresh.length ? ` NEW failures caused by your change: ${fresh.slice(0, 8).join("; ")}.` : " No new failures.")
  )
}

async function shell(sb: Sandbox, cmd: string, timeoutS: number | undefined, planMode: boolean, baseline?: Baseline): Promise<ToolOutput> {
  if (!cmd.trim()) return { ok: false, output: "command is empty" }
  const blocked = guard(cmd, planMode)
  if (blocked) return { ok: false, output: `Command rejected: ${blocked}` }
  const t = Math.min(Math.max(timeoutS ?? 120, 5), 600)
  const r = await sb.exec(cmd, t * 1000)
  const body = truncateOutput(r.stdout.trimEnd(), 8_000)
  const status = r.timedOut ? `Command timed out after ${t}s and was killed.` : `exit code ${r.exitCode}`
  const note = r.exitCode !== 0 ? annotateFailures(r.stdout, baseline) + tsErrorHints(r.stdout) : ""
  return { ok: r.exitCode === 0, output: `${body ? body + "\n" : ""}[${status}]${note}` }
}

const PERMISSION_Q = /\b(do you want me to|would you like me to|should i (go ahead|proceed|continue|implement)|shall i|may i|ok(ay)? to proceed|confirm (to|before|that i should) (proceed|continue)|proceed\?|continue\?)/i

// ── tool sets ────────────────────────────────────────────────────────────────

export function readOnlyTools(ws: Workspace, sb: Sandbox, planMode: boolean, baseline?: Baseline): Tool[] {
  const editor = new Editor(ws)
  return [
    {
      def: fn(
        "view",
        "View a file with line numbers (optionally a line range). Long files show an outline plus the first lines; request ranges to see more.",
        { path: str("Repo-relative path, e.g. src/app.ts"), start_line: int("1-based first line"), end_line: int("1-based last line (inclusive)") },
        ["path"],
      ),
      handler: async (a) => editor.view(argStr(a, "path"), argInt(a, "start_line"), argInt(a, "end_line")),
    },
    {
      def: fn("list_dir", "List a directory tree (default depth 2). Skips node_modules/.git.", { path: str("Repo-relative directory, '.' for root"), depth: int("1-4, default 2") }, ["path"]),
      handler: async (a) => listDir(ws, argStr(a, "path", false), Math.min(4, Math.max(1, argInt(a, "depth") ?? 2))),
    },
    {
      def: fn(
        "search",
        "Search file contents (git grep, POSIX extended regex; invalid regexes are searched literally). Returns matching lines, or per-file counts when there are many hits.",
        { pattern: str("Regex, e.g. 'function divide|divide\\('"), path: str("Optional directory or file to limit the search"), glob: str("Optional file glob, e.g. '*.ts'") },
        ["pattern"],
      ),
      handler: async (a) => search(ws, argStr(a, "pattern"), argStr(a, "path", false), argStr(a, "glob", false)),
    },
    {
      def: fn(
        "shell",
        planMode
          ? "Run a read-only bash command in the sandbox (e.g. run tests to see current behaviour, node -e checks). No file modifications in planning mode."
          : "Run a bash command in the sandbox at /workspace (tests, type-check, build, quick node -e checks). No network. Output is truncated.",
        { command: str("bash command"), timeout_s: int("Timeout in seconds (default 120, max 600)") },
        ["command"],
      ),
      handler: async (a) => shell(sb, argStr(a, "command"), argInt(a, "timeout_s"), planMode, baseline),
    },
  ]
}

export function planTools(ws: Workspace, sb: Sandbox, baseline?: Baseline): Tool[] {
  return [
    ...readOnlyTools(ws, sb, true, baseline),
    {
      def: fn(
        "submit_plan",
        "Submit the implementation plan. Call exactly once when you understand the change.",
        {
          summary: str("1-3 sentences: what will change and why"),
          requirements: {
            type: "array",
            description: "Every explicit requirement / acceptance criterion from the issue, one per item, phrased so it can be checked against a diff (e.g. 'GET /api/tasks returns { tasks, total, limit, offset }', 'Frontend callers read the new tasks key'). Include implied updates to callers when a signature or response shape changes.",
            items: { type: "string" },
            minItems: 1,
            maxItems: 15,
          },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              properties: { title: str("Concrete step, e.g. 'Throw RangeError in divide() when b === 0'"), files: { type: "array", items: { type: "string" } } },
              required: ["title", "files"],
              additionalProperties: false,
            },
          },
          files: {
            type: "array",
            description: "Every file the change will touch",
            items: { type: "object", properties: { path: str("repo-relative path"), new: { type: "boolean" } }, required: ["path", "new"], additionalProperties: false },
          },
          assumptions: {
            type: "array",
            maxItems: 8,
            description: "Every choice you made where the issue left room and the options behave differently (names, shapes, status codes, sync/async, scope). Empty only if the issue settles everything.",
            items: {
              type: "object",
              properties: {
                question: str("The open point, e.g. 'Which query parameters filter GET /books?'"),
                chosen: str("What the plan does"),
                alternatives: { type: "array", items: { type: "string" }, description: "Other reasonable readings (1-3)" },
                evidence: str("file:line that settles it, 'issue text', or 'no evidence — default'"),
                impact: { type: "string", enum: ["behavior", "cosmetic"] },
              },
              required: ["question", "chosen", "alternatives", "evidence", "impact"],
              additionalProperties: false,
            },
          },
          risks: str("Other notes worth a reviewer's attention (optional, empty if none)"),
          blocked: str("Only if the issue cannot be implemented without clarification: the question to ask. Otherwise empty."),
        },
        ["summary", "requirements", "steps", "files", "assumptions", "blocked"],
      ),
      handler: async (a) => {
        const steps = Array.isArray(a.steps) ? (a.steps as { title?: unknown; files?: unknown }[]) : []
        const files = Array.isArray(a.files) ? (a.files as { path?: unknown; new?: unknown }[]) : []
        if (steps.length === 0) throw new ArgError("steps must have 1-8 items")
        const plan: SubmittedPlan = {
          summary: argStr(a, "summary"),
          requirements: Array.isArray(a.requirements) ? (a.requirements as unknown[]).map(String).filter((r) => r.trim()).slice(0, 15) : [],
          steps: steps.slice(0, 8).map((s) => ({
            title: String(s.title ?? "").trim(),
            files: Array.isArray(s.files) ? s.files.map(String) : [],
          })),
          files: files.map((f) => ({ path: String(f.path ?? ""), new: Boolean(f.new) })).filter((f) => f.path),
          ...parseAssumptions(a.assumptions),
          ...splitBlocked(a.risks, a.blocked),
        }
        // Grounding: every existing-file reference must exist; bad steps are rejected with suggestions.
        const problems: string[] = []
        for (const f of plan.files) {
          let rel: string
          try {
            rel = ws.rel(f.path)
          } catch (e) {
            problems.push((e as Error).message)
            continue
          }
          f.path = rel
          if (!f.new && !ws.exists(rel)) {
            const s = await ws.suggest(rel, 3)
            problems.push(`${rel} does not exist${s.length ? ` (did you mean ${s.join(", ")}?)` : ""} — mark it new:true only if the plan creates it`)
          }
          if (f.new && ws.exists(rel)) f.new = false
        }
        const badStep = plan.steps.find((s) => /\b(clone|git (commit|push)|open (a )?(pr|pull request)|deploy|npm (install|ci)|install dependencies)\b/i.test(s.title))
        if (badStep) problems.push(`Step "${badStep.title}" is handled by the platform — remove it`)
        if (problems.length) throw new ArgError(`Plan rejected:\n- ${problems.join("\n- ")}\nFix and call submit_plan again.`)
        return { control: "submit_plan", plan }
      },
    },
  ]
}

export function runTools(ws: Workspace, sb: Sandbox, onPlanUpdate: (steps: { title: string; status: string }[]) => void, baseline?: Baseline): Tool[] {
  const editor = new Editor(ws)
  let asked = 0
  return [
    ...readOnlyTools(ws, sb, false, baseline),
    {
      def: fn(
        "str_replace",
        "Replace exactly one occurrence of old_str with new_str in an existing file. old_str must match the file exactly (whitespace included) and be unique; include enough surrounding lines.",
        { path: str("Repo-relative path"), old_str: str("Exact existing text"), new_str: str("Replacement text") },
        ["path", "old_str", "new_str"],
      ),
      handler: async (a) => editor.strReplace(argStr(a, "path"), argStr(a, "old_str"), argStr(a, "new_str", false)),
      mutates: true,
    },
    {
      def: fn("create_file", "Create a NEW file with the given content. Fails if the file exists.", { path: str("Repo-relative path"), content: str("Full file content") }, ["path", "content"]),
      handler: async (a) => editor.createFile(argStr(a, "path"), argStr(a, "content", false)),
      mutates: true,
    },
    {
      def: fn(
        "apply_patch",
        "Apply a multi-hunk / multi-file patch. Format:\n*** Begin Patch\n*** Update File: path/to/file.ts\n@@ optional line near the change (e.g. function signature)\n context line\n-removed line\n+added line\n*** Add File: path/new.ts\n+line of new file\n*** Delete File: path/old.ts\n*** End Patch\nContext and removed lines must match the file exactly; no line numbers. All-or-nothing.",
        { patch: str("The full patch text") },
        ["patch"],
      ),
      handler: async (a) => editor.applyPatch(argStr(a, "patch")),
      mutates: true,
    },
    {
      def: fn(
        "update_plan",
        "Update step statuses on the checklist shown to the user. Keep the approved plan's steps (same titles, same order) — only change their status. Exactly one step should be in_progress while working.",
        {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: { title: str("step"), status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
              required: ["title", "status"],
              additionalProperties: false,
            },
          },
        },
        ["steps"],
      ),
      handler: async (a) => {
        const steps = Array.isArray(a.steps) ? (a.steps as { title?: unknown; status?: unknown }[]) : []
        onPlanUpdate(steps.map((s) => ({ title: String(s.title ?? ""), status: String(s.status ?? "pending") })))
        return { ok: true, output: "Plan updated." }
      },
    },
    {
      def: fn("ask_user", "Ask the user one concrete question when you are blocked by a real ambiguity. Use sparingly.", { question: str("The question") }, ["question"]),
      handler: async (a) => {
        // Asking permission to do already-approved work only stalls the run (seen live).
        const q = argStr(a, "question")
        if (PERMISSION_Q.test(q))
          return { ok: false, output: "Not sent: the plan is already approved, so do not ask for permission or confirmation. Implement every remaining step now. Only ask when you are blocked by a genuine ambiguity the issue does not resolve." }
        asked++
        if (asked > 1) return { ok: false, output: "You already asked the user a question in this run. Follow their answer (or your most reasonable assumption) and continue; note any remaining doubt in your finish summary." }
        return { control: "ask_user", question: argStr(a, "question") }
      },
    },
    {
      def: fn(
        "finish",
        "Call when the change is implemented and verified. The platform then validates the diff (syntax, tests) and may send you back with findings.",
        {
          summary: str("What changed (files + behaviour) and how it was verified; note assumptions and pre-existing failures"),
          requirements: {
            type: "array",
            description: "One entry per requirement from the approved plan, in order: where/how it is satisfied (file + function), or 'NOT DONE: reason'.",
            items: { type: "string" },
          },
        },
        ["summary", "requirements"],
      ),
      handler: async (a) => {
        const reqs = Array.isArray(a.requirements) ? (a.requirements as unknown[]).map(String) : []
        const notDone = reqs.filter((r) => /^\s*not done/i.test(r))
        const summary = argStr(a, "summary") + (reqs.length ? `\n\nRequirements:\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : "")
        if (notDone.length) return { ok: false, output: `You marked ${notDone.length} requirement(s) as not done. Implement them, or if impossible, explain in the summary and call finish again with the reason.` }
        return { control: "finish", summary }
      },
    },
  ]
}
