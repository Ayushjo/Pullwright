import ts from "typescript"
import { readFile, stat } from "fs/promises"
import path from "path"
import type { Workspace } from "./workspace.js"

/**
 * Repo map, after aider's repomap.py (Apache-2.0):
 *   1. extract definitions + references per file
 *   2. build a file graph: referencing file → defining file, weighted per identifier
 *   3. personalised PageRank toward files/identifiers mentioned in the issue
 *   4. render the highest-ranked definitions until the token budget is used
 * Tagging uses the TypeScript compiler for JS/TS and light regexes elsewhere
 * (no native tree-sitter dependency).
 */

export type Def = { name: string; line: number; text: string; kind: string }
type FileTags = { file: string; defs: Def[]; refs: Map<string, number>; lines: number }

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|vendor|__pycache__|\.venv|target)(\/|$)/
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.map|\.lock|\.tsbuildinfo)$/
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|php|cs|swift|scala|c|h|cpp|hpp|vue|svelte)$/
const TEXT_EXT = /\.(md|json|ya?ml|toml|css|scss|html|sql|sh|env\.example|txt)$/
const MAX_FILE_BYTES = 300_000

const tokenCount = (s: string) => Math.ceil(s.length / 4)

const STOP = new Set("about above after again against these those their there where which while would could should should because before being below between during other under until with within without into from that this have what when your will make made using used uses need needs add adds added update updated change changes return returns value values issue issues please should must field fields file files function functions method methods endpoint currently expected actual behavior behaviour works working instead".split(" "))

function tsDefs(file: string, content: string): Def[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : file.match(/\.(m|c)?js$/) ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind)
  const lines = content.split("\n")
  const defs: Def[] = []
  const push = (node: ts.Node, name: string, k: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
    defs.push({ name, line: line + 1, text: (lines[line] ?? "").trim().slice(0, 140), kind: k })
  }
  const visit = (node: ts.Node, depth: number) => {
    if (ts.isFunctionDeclaration(node) && node.name) push(node, node.name.text, "function")
    else if (ts.isClassDeclaration(node) && node.name) {
      push(node, node.name.text, "class")
      node.members.forEach((m) => {
        if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name)) push(m, m.name.text, "method")
      })
    } else if (ts.isInterfaceDeclaration(node)) push(node, node.name.text, "interface")
    else if (ts.isTypeAliasDeclaration(node)) push(node, node.name.text, "type")
    else if (ts.isEnumDeclaration(node)) push(node, node.name.text, "enum")
    else if (ts.isVariableStatement(node) && depth === 0) {
      node.declarationList.declarations.forEach((d) => {
        if (ts.isIdentifier(d.name)) push(d, d.name.text, "const")
      })
    } else if (ts.isExportAssignment(node)) push(node, "default", "export")
    // Express-style route registration: router.get("/path", ...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(get|post|put|patch|delete|use)$/.test(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      push(node, `${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`, "route")
    }
    if (depth < 2 || ts.isCallExpression(node) || ts.isExpressionStatement(node) || ts.isBlock(node) || ts.isSourceFile(node)) {
      ts.forEachChild(node, (c) => visit(c, ts.isSourceFile(node) ? 0 : depth + 1))
    }
  }
  ts.forEachChild(sf, (c) => visit(c, 0))
  return defs
}

const REGEX_DEFS: [RegExp, RegExp, string][] = [
  [/\.py$/, /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/, ""],
  [/\.go$/, /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^type\s+([A-Za-z_]\w*)/, ""],
  [/\.rb$/, /^\s*(def|class|module)\s+([A-Za-z_][\w?!]*)/, ""],
  [/\.(java|kt|cs|scala|swift)$/, /^\s*(?:public|private|protected|internal|static|final|abstract|override|open|data|\s)*\s*(class|interface|enum|fun|func|void|record|struct)\s+([A-Za-z_]\w*)/, ""],
  [/\.rs$/, /^\s*(?:pub(?:\([^)]*\))?\s+)?(fn|struct|enum|trait|impl|mod)\s+([A-Za-z_]\w*)/, ""],
  [/\.php$/, /^\s*(?:public|private|protected|static|\s)*\s*(function|class|interface|trait)\s+([A-Za-z_]\w*)/, ""],
]

function regexDefs(file: string, content: string): Def[] {
  const entry = REGEX_DEFS.find(([ext]) => ext.test(file))
  if (!entry) return []
  const defs: Def[] = []
  content.split("\n").forEach((l, i) => {
    const m = l.match(entry[1])
    if (!m) return
    const name = m[2] ?? m[1]
    if (name) defs.push({ name, line: i + 1, text: l.trim().slice(0, 140), kind: m[1] ?? "def" })
  })
  return defs
}

export function extractDefs(file: string, content: string): Def[] {
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file)) {
    try {
      return tsDefs(file, content)
    } catch {
      return []
    }
  }
  return regexDefs(file, content)
}

/** Compact "line: declaration" outline for one large file. */
export function outline(file: string, content: string, max = 80): string {
  const defs = extractDefs(file, content)
  return defs
    .slice(0, max)
    .map((d) => `${String(d.line).padStart(5)}: ${d.text}`)
    .join("\n")
}

function refsOf(content: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const tok of content.match(/[A-Za-z_$][\w$]{2,}/g) ?? []) m.set(tok, (m.get(tok) ?? 0) + 1)
  return m
}

async function tagFile(ws: Workspace, file: string): Promise<FileTags | null> {
  try {
    const abs = path.join(ws.root, file)
    const st = await stat(abs)
    if (st.size > MAX_FILE_BYTES) return null
    const content = await readFile(abs, "utf8")
    return { file, defs: extractDefs(file, content), refs: refsOf(content), lines: content.split("\n").length }
  } catch {
    return null
  }
}

function pagerank(nodes: string[], edges: Map<string, Map<string, number>>, pers: Map<string, number>, iters = 40, d = 0.85) {
  const n = nodes.length
  const persTotal = [...pers.values()].reduce((a, b) => a + b, 0)
  const p = new Map(nodes.map((x) => [x, persTotal > 0 ? (pers.get(x) ?? 0) / persTotal : 1 / n]))
  let rank = new Map(nodes.map((x) => [x, 1 / n]))
  const outW = new Map(nodes.map((x) => [x, [...(edges.get(x)?.values() ?? [])].reduce((a, b) => a + b, 0)]))
  for (let it = 0; it < iters; it++) {
    const next = new Map(nodes.map((x) => [x, (1 - d) * p.get(x)!]))
    let dangling = 0
    for (const u of nodes) {
      const w = outW.get(u)!
      if (w === 0) {
        dangling += rank.get(u)!
        continue
      }
      for (const [v, ew] of edges.get(u)!) next.set(v, next.get(v)! + (d * rank.get(u)! * ew) / w)
    }
    for (const x of nodes) next.set(x, next.get(x)! + d * dangling * p.get(x)!)
    rank = next
  }
  return rank
}

export type RepoMap = { text: string; files: string[]; rankedFiles: string[] }

export async function buildRepoMap(ws: Workspace, issueText: string, budgetTokens = 1800): Promise<RepoMap> {
  const all = (await ws.listFiles()).filter((f) => !SKIP_DIR.test(f) && !SKIP_FILE.test(f))
  const code = all.filter((f) => CODE_EXT.test(f))
  const tags = (await Promise.all(code.map((f) => tagFile(ws, f)))).filter((t): t is FileTags => t !== null)

  // Identifiers mentioned in the issue. Code-like tokens (camelCase, snake_case, digits, `backticked`)
  // are strong signals; plain English words are weak ones.
  const backticked = new Set((issueText.match(/`([^`]+)`/g) ?? []).flatMap((m) => m.slice(1, -1).match(/[A-Za-z_$][\w$]{2,}/g) ?? []))
  const words = issueText.match(/[A-Za-z_$][\w$]{2,}/g) ?? []
  const strong = new Set(words.filter((w) => backticked.has(w) || /[a-z][A-Z]|_|\d|^[A-Z][a-z]+[A-Z]/.test(w)))
  const weak = new Set(words.filter((w) => !strong.has(w) && w.length >= 5 && !STOP.has(w.toLowerCase())).map((w) => w))
  const mentionedIdents = new Set([...strong, ...weak])
  const routePaths = (issueText.match(/\/[a-z0-9_-]+(?:\/[a-z0-9_:-]+)+/gi) ?? []).map((r) => r.toLowerCase())
  const lowerIssue = issueText.toLowerCase()
  const mentionedFiles = new Set(
    all.filter((f) => {
      const base = path.posix.basename(f).toLowerCase()
      const stem = base.replace(/\.[^.]+$/, "")
      return (
        lowerIssue.includes(f.toLowerCase()) ||
        (base.includes(".") && lowerIssue.includes(base)) ||
        (stem.length >= 5 && [...strong].some((w) => w.toLowerCase() === stem))
      )
    }),
  )
  const identWeight = (id: string) => (strong.has(id) ? 10 : weak.has(id) ? 1.5 : 1)

  const defines = new Map<string, Set<string>>()
  for (const t of tags) for (const d of t.defs) {
    if (!defines.has(d.name)) defines.set(d.name, new Set())
    defines.get(d.name)!.add(t.file)
  }

  const nodes = tags.map((t) => t.file)
  const edges = new Map<string, Map<string, number>>(nodes.map((n) => [n, new Map()]))
  const identEdge = new Map<string, Map<string, number>>() // `${src}\0${dst}` → ident → weight
  for (const t of tags) {
    for (const [ident, count] of t.refs) {
      const definers = defines.get(ident)
      if (!definers) continue
      let mul = identWeight(ident)
      if (ident.length >= 8 && /[a-z][A-Z]|_|-/.test(ident)) mul *= 10
      if (ident.startsWith("_")) mul *= 0.1
      if (definers.size > 5) mul *= 0.1
      if (mentionedFiles.has(t.file)) mul *= 50
      const w = mul * Math.sqrt(count)
      for (const def of definers) {
        if (def === t.file) continue
        const e = edges.get(t.file)!
        e.set(def, (e.get(def) ?? 0) + w)
        const key = `${t.file}\0${def}`
        if (!identEdge.has(key)) identEdge.set(key, new Map())
        identEdge.get(key)!.set(ident, (identEdge.get(key)!.get(ident) ?? 0) + w)
      }
    }
  }

  const isRouteHit = (d: Def) => d.kind === "route" && routePaths.some((r) => d.name.toLowerCase().includes(r))
  const pers = new Map<string, number>()
  for (const f of nodes) if (mentionedFiles.has(f)) pers.set(f, 100)
  for (const t of tags) {
    let p = 0
    for (const d of t.defs) {
      if (strong.has(d.name)) p += 50
      else if (weak.has(d.name)) p += 3
      if (isRouteHit(d)) p += 50
    }
    if (p) pers.set(t.file, (pers.get(t.file) ?? 0) + p)
  }

  const rank = nodes.length ? pagerank(nodes, edges, pers) : new Map<string, number>()

  // Score (file, ident) definitions by rank flowing along identifier edges.
  const defScore = new Map<string, number>() // `${file}\0${ident}`
  for (const [key, identW] of identEdge) {
    const [src, dst] = key.split("\0") as [string, string]
    const total = [...(edges.get(src)?.values() ?? [])].reduce((a, b) => a + b, 0)
    if (!total) continue
    for (const [ident, w] of identW) {
      const k = `${dst}\0${ident}`
      defScore.set(k, (defScore.get(k) ?? 0) + (rank.get(src)! * w) / total)
    }
  }
  for (const t of tags) for (const d of t.defs) {
    const k = `${t.file}\0${d.name}`
    const bonus = strong.has(d.name) || isRouteHit(d) ? 1 : weak.has(d.name) ? 0.05 : 0
    defScore.set(k, (defScore.get(k) ?? 0) + (rank.get(t.file) ?? 0) * 0.2 + bonus)
  }

  const byFile = new Map(tags.map((t) => [t.file, t]))
  const fileScore = new Map<string, number>()
  for (const [k, v] of defScore) {
    const f = k.slice(0, k.indexOf("\0"))
    fileScore.set(f, Math.max(fileScore.get(f) ?? 0, v))
  }
  const rankedFiles = [...nodes].sort(
    (a, b) =>
      Number(mentionedFiles.has(b)) - Number(mentionedFiles.has(a)) ||
      (fileScore.get(b) ?? 0) + (rank.get(b) ?? 0) - ((fileScore.get(a) ?? 0) + (rank.get(a) ?? 0)),
  )
  const rankedDefs = [...defScore.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split("\0") as [string, string])
  const PER_FILE = 14

  const render = (nDefs: number) => {
    const chosen = new Map<string, Def[]>()
    for (const [file, ident] of rankedDefs.slice(0, nDefs)) {
      const d = byFile.get(file)?.defs.find((x) => x.name === ident)
      if (!d) continue
      if (!chosen.has(file)) chosen.set(file, [])
      const list = chosen.get(file)!
      if (list.length < PER_FILE && !list.includes(d)) list.push(d)
    }
    const order = rankedFiles.filter((f) => chosen.has(f))
    const out: string[] = []
    for (const f of order) {
      const defs = chosen.get(f)!.sort((a, b) => a.line - b.line)
      out.push(`${f} (${byFile.get(f)?.lines ?? "?"} lines):`)
      for (const d of defs) out.push(`  ${String(d.line).padStart(4)}│ ${d.text}`)
    }
    return out.join("\n")
  }

  // Binary search the number of definitions that fits the budget (aider's approach).
  let lo = 0
  let hi = rankedDefs.length
  let best = ""
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const txt = render(mid)
    if (tokenCount(txt) <= budgetTokens) {
      best = txt
      lo = mid + 1
    } else hi = mid - 1
  }

  // Plain file list (grouped) so the model knows what exists beyond the ranked defs.
  const listing = compactTree(all, 120)
  const text =
    `## Files (${all.length})\n${listing}\n\n## Ranked code map (most relevant first; "line│ declaration")\n${best || "(no code definitions found)"}`
  return { text, files: all, rankedFiles }
}

function compactTree(files: string[], maxLines: number): string {
  if (files.length <= maxLines) return files.join("\n")
  const dirs = new Map<string, number>()
  for (const f of files) {
    const d = path.posix.dirname(f)
    dirs.set(d, (dirs.get(d) ?? 0) + 1)
  }
  const top = files.filter((f) => !f.includes("/"))
  const lines = [...top, ...[...dirs.entries()].filter(([d]) => d !== ".").map(([d, n]) => `${d}/ (${n} files)`)]
  return lines.slice(0, maxLines).join("\n") + (lines.length > maxLines ? `\n… ${lines.length - maxLines} more` : "")
}

export { TEXT_EXT }
