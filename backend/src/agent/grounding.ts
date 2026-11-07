import { execFile } from "child_process"
import { promisify } from "util"
import type { Workspace } from "./workspace.js"

const execFileP = promisify(execFile)

/**
 * Deterministic grounding check (no LLM): which files and code identifiers that the issue
 * mentions actually exist in the repository? Missing ones are surfaced to the planner so it
 * asks instead of inventing them (the #1 failure mode of the old agent).
 */
/** Standard-library names an issue can mention without the repo defining them (JS/TS, Python, Go, Rust, Java). */
const BUILTINS = new Set(
  (
    "Infinity NaN undefined null Error RangeError TypeError SyntaxError ReferenceError EvalError URIError AggregateError Promise Array Object String Number Boolean Symbol BigInt Map Set WeakMap WeakSet Date RegExp JSON Math Intl Reflect Proxy console process Buffer setTimeout setInterval clearTimeout fetch Response Request URL URLSearchParams AbortController structuredClone parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent toFixed toString valueOf hasOwnProperty localeCompare normalize " +
    "ValueError KeyError IndexError AttributeError RuntimeError NotImplementedError ZeroDivisionError FileNotFoundError StopIteration AssertionError Exception None True False isinstance print len " +
    "NullPointerException IllegalArgumentException IllegalStateException RuntimeException IOException Option Result Some None Ok Err Vec HashMap"
  ).split(" "),
)

export type Grounding = { missingPaths: string[]; missingSymbols: string[]; foundPaths: string[]; newPaths?: string[]; newSymbols?: string[] }

/** "add a new `x.ts`", "create x.ts", "in a new file x.ts" → the issue asks for it, it is not a hallucination risk. */
const CREATE_CUE = /\b(new|create[sd]?|creating|add(?:ing)?\s+(?:a|an)|introduce)\b[^.\n]{0,40}$/i

const PATH_RE = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6})(?=$|[\s`'"),.:;\]])/gm
const CODE_SPAN = /`([^`\n]{2,80})`/g

export async function groundIssue(ws: Workspace, text: string): Promise<Grounding> {
  const files = await ws.listFiles()
  const fileSet = new Set(files)
  const paths = new Set<string>()
  const toCreate = new Set<string>()
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1]!.replace(/^\.\//, "").replace(/^\/+/, "")
    if (/^https?:|^www\.|\.(com|org|io|dev)$/i.test(p) || p.includes("://")) continue
    paths.add(p)
    if (CREATE_CUE.test(text.slice(Math.max(0, m.index! - 50), m.index! + 1))) toCreate.add(p)
  }
  const missingPaths: string[] = []
  const foundPaths: string[] = []
  const newPaths: string[] = []
  for (const p of paths) {
    const hit = fileSet.has(p) || files.some((f) => f.endsWith("/" + p))
    ;(hit ? foundPaths : toCreate.has(p) ? newPaths : missingPaths).push(p)
  }

  // Code identifiers: backticked spans that look like symbols (Foo, fooBar, foo_bar, foo(), Foo.bar)
  const symbols = new Set<string>()
  const specified = new Set<string>()
  for (const m of text.matchAll(CODE_SPAN)) {
    const span = m[1]!.trim().replace(/\)\s*(:|=>|→).*$/, ")") // drop a return type
    if (/\/|\s(?![^(]*\))/.test(span) || /\.[a-z]{1,5}$/.test(span)) continue // phrases / paths
    const ident = span.replace(/\(.*\)$/, "").split(".").pop() ?? ""
    if (BUILTINS.has(ident)) continue // language built-ins (RangeError, Infinity, …) are never "missing from the repo"
    if (/^[A-Za-z_$][\w$]{2,}$/.test(ident) && (/[A-Z]/.test(ident) || /_/.test(ident) || span.endsWith(")") || /\(.*\)/.test(span))) {
      symbols.add(ident)
      // A spec item: listed as a bullet ("- `foo(x)` does …") or introduced by a create cue, and not described as existing.
      const lineStart = text.lastIndexOf("\n", m.index!) + 1
      const line = text.slice(lineStart, text.indexOf("\n", m.index!) >>> 0)
      const before = text.slice(Math.max(0, m.index! - 50), m.index! + 1)
      if (!/\b(existing|current(ly)?|already)\b/i.test(line) && (/^\s*([-*+]|\d+[.)])\s/.test(line) || CREATE_CUE.test(before))) specified.add(ident)
    }
  }
  const missingSymbols: string[] = []
  const newSymbols: string[] = []
  for (const sym of symbols) {
    try {
      await execFileP("git", ["grep", "-q", "--untracked", "-I", "-w", "-e", sym], { cwd: ws.root })
    } catch {
      ;(specified.has(sym) ? newSymbols : missingSymbols).push(sym)
    }
  }
  return { missingPaths, missingSymbols, foundPaths, newPaths, newSymbols }
}

export function groundingNote(g: Grounding): string {
  if (!g.missingPaths.length && !g.missingSymbols.length && !g.newPaths?.length && !g.newSymbols?.length) return ""
  return [
    "## Grounding check (automated — verified against the repository)",
    g.newSymbols?.length ? `The issue specifies these new functions/symbols (not in the repo yet — you will create them): ${g.newSymbols.map((p) => `\`${p}\``).join(", ")}` : "",
    g.newPaths?.length ? `The issue asks for these new files (they don't exist yet — plan them as new): ${g.newPaths.map((p) => `\`${p}\``).join(", ")}` : "",
    g.missingPaths.length ? `These paths mentioned in the issue do NOT exist: ${g.missingPaths.map((p) => `\`${p}\``).join(", ")}` : "",
    g.missingSymbols.length ? `These code symbols mentioned in the issue are NOT defined anywhere in the repository: ${g.missingSymbols.map((p) => `\`${p}\``).join(", ")}` : "",
    !g.missingPaths.length && !g.missingSymbols.length ? "" : "If the issue treats them as already existing, do not invent them — set `blocked` with a concrete question. If the issue asks for them to be created, planning them as new files is fine.",
  ]
    .filter(Boolean)
    .join("\n")
}
