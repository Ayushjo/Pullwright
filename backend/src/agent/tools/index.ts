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

const execFileP = promisify(execFile)

export type Control =
  | { control: "finish"; summary: string }
  | { control: "submit_plan"; plan: SubmittedPlan }
  | { control: "ask_user"; question: string }

export type SubmittedPlan = {
  summary: string
  steps: { title: string; files: string[] }[]
  files: { path: string; new: boolean }[]
  risks?: string
  blocked?: string
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
    const args = ["grep", "--untracked", "-n", "-I", "-E", "--no-color", "-e", pattern, "--", pathspec]
    let stdout = ""
    try {
      stdout = (await execFileP("git", args, { cwd: ws.root, maxBuffer: 16 * 1024 * 1024 })).stdout
    } catch (err) {
      const e = err as { code?: number; stderr?: string }
      if (e.code === 1) return { ok: true, output: `No matches for /${pattern}/${rel ? " in " + rel : ""}.` }
      return { ok: false, output: `search failed: ${e.stderr?.trim() || "invalid pattern"}. Patterns are POSIX extended regex.` }
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
    return { ok: true, output: lines.map((l) => (l.length > 300 ? l.slice(0, 300) + "…" : l)).join("\n") }
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

async function shell(sb: Sandbox, cmd: string, timeoutS: number | undefined, planMode: boolean): Promise<ToolOutput> {
  if (!cmd.trim()) return { ok: false, output: "command is empty" }
  const blocked = guard(cmd, planMode)
  if (blocked) return { ok: false, output: `Command rejected: ${blocked}` }
  const t = Math.min(Math.max(timeoutS ?? 120, 5), 600)
  const r = await sb.exec(cmd, t * 1000)
  const body = truncateOutput(r.stdout.trimEnd(), 8_000)
  const status = r.timedOut ? `Command timed out after ${t}s and was killed.` : `exit code ${r.exitCode}`
  return { ok: r.exitCode === 0, output: `${body ? body + "\n" : ""}[${status}]` }
}

// ── tool sets ────────────────────────────────────────────────────────────────

export function readOnlyTools(ws: Workspace, sb: Sandbox, planMode: boolean): Tool[] {
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
        "Search file contents with a POSIX extended regex (git grep). Returns matching lines, or per-file counts when there are many hits.",
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
      handler: async (a) => shell(sb, argStr(a, "command"), argInt(a, "timeout_s"), planMode),
    },
  ]
}

export function planTools(ws: Workspace, sb: Sandbox): Tool[] {
  return [
    ...readOnlyTools(ws, sb, true),
    {
      def: fn(
        "submit_plan",
        "Submit the implementation plan. Call exactly once when you understand the change.",
        {
          summary: str("1-3 sentences: what will change and why"),
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 5,
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
          risks: str("Ambiguities, assumptions, or mismatches between the issue and the code (empty if none)"),
          blocked: str("Only if the issue cannot be implemented without clarification: the question to ask. Otherwise empty."),
        },
        ["summary", "steps", "files", "risks", "blocked"],
      ),
      handler: async (a) => {
        const steps = Array.isArray(a.steps) ? (a.steps as { title?: unknown; files?: unknown }[]) : []
        const files = Array.isArray(a.files) ? (a.files as { path?: unknown; new?: unknown }[]) : []
        if (steps.length === 0) throw new ArgError("steps must have 1-5 items")
        const plan: SubmittedPlan = {
          summary: argStr(a, "summary"),
          steps: steps.slice(0, 5).map((s) => ({
            title: String(s.title ?? "").trim(),
            files: Array.isArray(s.files) ? s.files.map(String) : [],
          })),
          files: files.map((f) => ({ path: String(f.path ?? ""), new: Boolean(f.new) })).filter((f) => f.path),
          ...(typeof a.risks === "string" && a.risks.trim() ? { risks: a.risks.trim() } : {}),
          ...(typeof a.blocked === "string" && a.blocked.trim() ? { blocked: a.blocked.trim() } : {}),
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

export function runTools(ws: Workspace, sb: Sandbox, onPlanUpdate: (steps: { title: string; status: string }[]) => void): Tool[] {
  const editor = new Editor(ws)
  return [
    ...readOnlyTools(ws, sb, false),
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
        "Update the checklist shown to the user. Exactly one step should be in_progress while working.",
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
      handler: async (a) => ({ control: "ask_user", question: argStr(a, "question") }),
    },
    {
      def: fn(
        "finish",
        "Call when the change is implemented and verified. The platform then validates the diff (syntax, tests) and may send you back with findings.",
        { summary: str("What changed (files + behaviour) and how it was verified; note assumptions and pre-existing failures") },
        ["summary"],
      ),
      handler: async (a) => ({ control: "finish", summary: argStr(a, "summary") }),
    },
  ]
}
