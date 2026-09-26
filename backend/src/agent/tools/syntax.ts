import ts from "typescript"

/**
 * Fast, dependency-free syntax check used by the lint guard.
 * Only *syntactic* errors — never type errors — so a check is ~1ms and never
 * blocks an edit because of an unrelated type problem elsewhere in the repo.
 */

const TS_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
}

export type SyntaxIssue = { line: number; message: string }

export function checkSyntax(filePath: string, content: string): SyntaxIssue[] | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  const kind = TS_KINDS[ext]
  if (kind !== undefined) {
    // .js files may contain JSX in React projects — parse them as JSX to avoid false positives.
    const effectiveKind = kind === ts.ScriptKind.JS ? ts.ScriptKind.JSX : kind
    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, effectiveKind)
    const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
    return diags.map((d) => ({
      line: d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    }))
  }
  if (ext === ".json") {
    const base = filePath.split("/").pop() ?? ""
    // tsconfig/jsconfig/.eslintrc etc. allow comments & trailing commas
    if (/^(tsconfig|jsconfig).*\.json$|^\.eslintrc|\.jsonc$/.test(base)) {
      const r = ts.parseConfigFileTextToJson(filePath, content)
      return r.error ? [{ line: 0, message: ts.flattenDiagnosticMessageText(r.error.messageText, "\n") }] : []
    }
    try {
      JSON.parse(content)
      return []
    } catch (e) {
      return [{ line: 0, message: (e as Error).message }]
    }
  }
  return null // unsupported language → no check
}

/** Errors present in `after` but not in `before` (multiset by message; line numbers shift). */
export function newSyntaxErrors(filePath: string, before: string | null, after: string): SyntaxIssue[] {
  const post = checkSyntax(filePath, after)
  if (!post || post.length === 0) return []
  const pre = before === null ? [] : (checkSyntax(filePath, before) ?? [])
  // An already-broken file re-parses unpredictably after any edit (cascading errors), so the
  // guard can't attribute errors to this edit — let it through; the gate re-checks vs base.
  if (pre.length > 0) return []
  const budget = new Map<string, number>()
  for (const e of pre) budget.set(e.message, (budget.get(e.message) ?? 0) + 1)
  const fresh: SyntaxIssue[] = []
  for (const e of post) {
    const n = budget.get(e.message) ?? 0
    if (n > 0) budget.set(e.message, n - 1)
    else fresh.push(e)
  }
  return fresh
}
