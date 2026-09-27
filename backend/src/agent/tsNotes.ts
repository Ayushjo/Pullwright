import path from "path"
import type { Workspace } from "./workspace.js"

/**
 * Strict TypeScript settings trip small models: on a `noUncheckedIndexedAccess` repo gpt-5-mini
 * needed four compile rounds to handle `string | undefined` regex groups. Two cheap, deterministic
 * helps: tell the agent the enforced flags up front, and attach fix recipes to tsc errors.
 */

type Opts = Record<string, unknown>

/** JSONC → JSON: drop comments (outside strings) and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = ""
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inStr) {
      out += c
      if (c === "\\") out += text[++i] ?? ""
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
      out += c
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

async function loadOptions(ws: Workspace, file: string, seen = new Set<string>()): Promise<Opts> {
  if (seen.has(file) || seen.size > 6 || !ws.exists(file)) return {}
  seen.add(file)
  let cfg: { extends?: unknown; compilerOptions?: Opts; references?: { path?: string }[] }
  try {
    cfg = parseJsonc(await ws.read(file)) as typeof cfg
  } catch {
    return {}
  }
  const dir = path.posix.dirname(file)
  let opts: Opts = {}
  for (const ext of [cfg.extends].flat()) {
    if (typeof ext === "string" && ext.startsWith(".")) {
      const p = path.posix.normalize(path.posix.join(dir, ext.endsWith(".json") ? ext : `${ext}.json`))
      opts = { ...opts, ...(await loadOptions(ws, p, seen)) }
    }
  }
  opts = { ...opts, ...(cfg.compilerOptions ?? {}) }
  // Solution-style configs (tsc -b) keep the real options in referenced projects.
  for (const ref of cfg.references ?? []) {
    if (typeof ref.path !== "string") continue
    const p = path.posix.normalize(path.posix.join(dir, ref.path))
    const refOpts = await loadOptions(ws, p.endsWith(".json") ? p : `${p}/tsconfig.json`, seen)
    for (const [k, v] of Object.entries(refOpts)) if (v === true || opts[k] === undefined) opts[k] = v
  }
  return opts
}

/** "## TypeScript settings" note for the prompts, or "" if the repo has no tsconfig. */
export async function tsSettingsNote(ws: Workspace, pkgDirs: string[]): Promise<string> {
  const lines: string[] = []
  for (const dir of pkgDirs.length ? pkgDirs : ["."]) {
    const file = dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`
    if (!ws.exists(file)) continue
    const o = await loadOptions(ws, file)
    const rules: string[] = []
    const mod = String(o.module ?? o.moduleResolution ?? "").toLowerCase()
    if (o.noUncheckedIndexedAccess) rules.push("`noUncheckedIndexedAccess`: `arr[i]`, `obj[key]` and regex groups (`m[1]`) are `T | undefined` — use `?? fallback`, a guard, or `const [, a = \"\"] = m`; avoid `!`")
    if (o.exactOptionalPropertyTypes) rules.push("`exactOptionalPropertyTypes`: never assign `undefined` to an optional property — spread it conditionally: `...(v !== undefined ? { k: v } : {})`")
    if (o.strict) rules.push("`strict`: null/undefined must be handled; no implicit `any` parameters")
    if (o.noUnusedLocals || o.noUnusedParameters) rules.push("unused imports/locals/params fail the build — remove them (prefix an unused parameter with `_`)")
    if (/node(16|next)/.test(mod)) rules.push("NodeNext modules: relative imports need the `.js` extension (`./foo.js`) even in .ts files")
    if (o.verbatimModuleSyntax) rules.push("`verbatimModuleSyntax`: type-only imports must use `import type`")
    if (o.erasableSyntaxOnly) rules.push("`erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties")
    if (rules.length) lines.push(`- ${dir === "." ? "root" : dir}: ${rules.join("; ")}`)
  }
  return lines.length ? `## TypeScript settings (enforced by the type-check — write code that passes them first time)\n${lines.join("\n")}` : ""
}

const HINTS: [RegExp, string][] = [
  [/TS(2532|18048|18047)|TS(2345|2322)[^\n]*undefined/, "possibly `undefined`: narrow first (`if (!x) return …`), use `x ?? fallback` / `x?.y`, or destructure with a default (`const [, id = \"\"] = match`)."],
  [/TS(2375|2379|2412)/, "exactOptionalPropertyTypes: omit the property instead of passing `undefined` — `...(v !== undefined ? { key: v } : {})`."],
  [/TS(6133|6192|6196|6198)/, "unused declaration: delete it (or prefix an unused parameter with `_`)."],
  [/TS(2835|2834)/, "relative import needs an explicit `.js` extension (NodeNext)."],
  [/TS(1484|1371)/, "type-only import: use `import type { … }`."],
  [/TS(2304|2552|2305|2724)/, "missing name/export: add the import, or check the exported name with search."],
  [/TS7006/, "implicit `any`: annotate the parameter type."],
  [/TS2339/, "property does not exist on the type: extend the type/interface, or narrow the union before accessing it."],
]

/** One-line fix recipes for the TypeScript error codes present in `output`. */
export function tsErrorHints(output: string): string {
  if (!/error TS\d+/.test(output)) return ""
  const hits = HINTS.filter(([re]) => re.test(output)).map(([, h]) => `- ${h}`)
  return hits.length ? `\n[platform note] TypeScript fix recipes for these errors:\n${hits.slice(0, 5).join("\n")}` : ""
}
