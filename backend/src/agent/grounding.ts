import { execFile } from "child_process"
import { promisify } from "util"
import type { Workspace } from "./workspace.js"

const execFileP = promisify(execFile)

/**
 * Deterministic grounding check (no LLM): which files and code identifiers that the issue
 * mentions actually exist in the repository? Missing ones are surfaced to the planner so it
 * asks instead of inventing them (the #1 failure mode of the old agent).
 */
export type Grounding = { missingPaths: string[]; missingSymbols: string[]; foundPaths: string[] }

const PATH_RE = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6})(?=$|[\s`'"),.:;\]])/gm
const CODE_SPAN = /`([^`\n]{2,80})`/g

export async function groundIssue(ws: Workspace, text: string): Promise<Grounding> {
  const files = await ws.listFiles()
  const fileSet = new Set(files)
  const paths = new Set<string>()
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1]!.replace(/^\.\//, "").replace(/^\/+/, "")
    if (/^https?:|^www\.|\.(com|org|io|dev)$/i.test(p) || p.includes("://")) continue
    paths.add(p)
  }
  const missingPaths: string[] = []
  const foundPaths: string[] = []
  for (const p of paths) {
    const hit = fileSet.has(p) || files.some((f) => f.endsWith("/" + p))
    ;(hit ? foundPaths : missingPaths).push(p)
  }

  // Code identifiers: backticked spans that look like symbols (Foo, fooBar, foo_bar, foo(), Foo.bar)
  const symbols = new Set<string>()
  for (const m of text.matchAll(CODE_SPAN)) {
    const span = m[1]!.trim()
    if (/[\s/]/.test(span) || /\.[a-z]{1,5}$/.test(span)) continue // phrases / paths
    const ident = span.replace(/\(.*\)$/, "").split(".").pop() ?? ""
    if (/^[A-Za-z_$][\w$]{2,}$/.test(ident) && (/[A-Z]/.test(ident) || /_/.test(ident) || span.endsWith(")"))) symbols.add(ident)
  }
  const missingSymbols: string[] = []
  for (const sym of symbols) {
    try {
      await execFileP("git", ["grep", "-q", "--untracked", "-I", "-w", "-e", sym], { cwd: ws.root })
    } catch {
      missingSymbols.push(sym)
    }
  }
  return { missingPaths, missingSymbols, foundPaths }
}

export function groundingNote(g: Grounding): string {
  if (!g.missingPaths.length && !g.missingSymbols.length) return ""
  return [
    "## Grounding check (automated — verified against the repository)",
    g.missingPaths.length ? `These paths mentioned in the issue do NOT exist: ${g.missingPaths.map((p) => `\`${p}\``).join(", ")}` : "",
    g.missingSymbols.length ? `These code symbols mentioned in the issue are NOT defined anywhere in the repository: ${g.missingSymbols.map((p) => `\`${p}\``).join(", ")}` : "",
    "If the issue treats them as already existing, do not invent them — set `blocked` with a concrete question. If the issue asks for them to be created, planning them as new files is fine.",
  ]
    .filter(Boolean)
    .join("\n")
}
