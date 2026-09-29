import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "fs"
import { execFileSync } from "child_process"
import os from "os"
import path from "path"
import { Workspace } from "../workspace.js"
import { Editor } from "../tools/editor.js"
import { parsePatch, applyChunks, seekSequence } from "../tools/patch.js"
import { newSyntaxErrors } from "../tools/syntax.js"
import { filterPatch } from "../pipeline.js"
import { redact } from "../git.js"
import { SpendLedger, costOf } from "../spend.js"
import { parseFailures, routeConsumers } from "../gate.js"
import { diffStat } from "../git.js"
import { groundIssue } from "../grounding.js"

let root: string
let ed: Editor
let ws: Workspace

const APP = `export function add(a, b) {
  return a + b
}

export function divide(a, b) {
  return a / b
}
`

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pw-ed-"))
  execFileSync("git", ["init", "-q"], { cwd: root })
  mkdirSync(path.join(root, "src"))
  writeFileSync(path.join(root, "src/math.js"), APP)
  writeFileSync(path.join(root, "src/dup.js"), "x = 1\nx = 1\n")
  ws = new Workspace(root)
  ed = new Editor(ws)
})

describe("str_replace", () => {
  it("replaces a unique match and returns a snippet", async () => {
    const r = await ed.strReplace("src/math.js", "  return a / b", "  if (b === 0) throw new RangeError('div by zero')\n  return a / b")
    expect(r.ok).toBe(true)
    expect(readFileSync(path.join(root, "src/math.js"), "utf8")).toContain("RangeError")
    expect(r.output).toContain("Snippet")
  })
  it("rejects ambiguous matches with line numbers", async () => {
    const r = await ed.strReplace("src/dup.js", "x = 1", "x = 2")
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/lines 1, 2/)
  })
  it("tolerates trailing whitespace differences", async () => {
    const r = await ed.strReplace("/workspace/src/math.js", "  return a / b   ", "  return a / b // ok")
    expect(r.ok).toBe(true)
  })
  it("reverts edits that introduce syntax errors", async () => {
    const r = await ed.strReplace("src/math.js", "  return a / b\n}", "  return a / b\n")
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/REVERTED/)
    expect(readFileSync(path.join(root, "src/math.js"), "utf8")).toBe(APP)
  })
  it("suggests real paths for hallucinated ones", async () => {
    const r = await ed.strReplace("lib/math.js", "a", "b")
    expect(r.ok).toBe(false)
    expect(r.output).toContain("src/math.js")
  })
  it("never touches .git or .env", async () => {
    expect((await ed.view(".git/config")).ok).toBe(false)
    expect((await ed.createFile(".env", "X=1")).ok).toBe(false)
    expect((await ed.view("../../etc/passwd")).ok).toBe(false)
  })
})

describe("create_file", () => {
  it("refuses to overwrite existing files", async () => {
    const r = await ed.createFile("src/math.js", "oops")
    expect(r.ok).toBe(false)
    expect(readFileSync(path.join(root, "src/math.js"), "utf8")).toBe(APP)
  })
})

describe("apply_patch", () => {
  it("applies update + add hunks atomically", async () => {
    const r = await ed.applyPatch(`*** Begin Patch
*** Update File: src/math.js
@@ export function divide(a, b) {
-  return a / b
+  if (b === 0) throw new RangeError("Division by zero")
+  return a / b
*** Add File: src/index.js
+export * from "./math.js"
*** End Patch`)
    expect(r.ok).toBe(true)
    expect(readFileSync(path.join(root, "src/math.js"), "utf8")).toContain("RangeError")
    expect(readFileSync(path.join(root, "src/index.js"), "utf8")).toBe('export * from "./math.js"\n')
  })
  it("modifies nothing when any hunk fails", async () => {
    const r = await ed.applyPatch(`*** Begin Patch
*** Add File: src/new.js
+ok
*** Update File: src/math.js
@@
-  return nope
+  return yes
*** End Patch`)
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/Failed to find expected lines/)
    expect(ws.exists("src/new.js")).toBe(false)
  })
  it("rejects patches that would break syntax", async () => {
    const r = await ed.applyPatch(`*** Begin Patch
*** Update File: src/math.js
@@
-export function add(a, b) {
+export function add(a, b {
*** End Patch`)
    expect(r.ok).toBe(false)
    expect(readFileSync(path.join(root, "src/math.js"), "utf8")).toBe(APP)
  })
  it("tolerates markdown fences around the patch", () => {
    expect(parsePatch("```\n*** Begin Patch\n*** Delete File: a.js\n*** End Patch\n```")).toHaveLength(1)
  })
})

describe("seek + chunks", () => {
  it("matches with unicode punctuation normalisation", () => {
    expect(seekSequence(["const s = “hi”"], ['const s = "hi"'], 0, false)).toBe(0)
  })
  it("pure insertion appends", () => {
    expect(applyChunks("f", "a\nb\n", [{ oldLines: [], newLines: ["c"], eof: false }])).toBe("a\nb\nc\n")
  })
})

describe("syntax guard", () => {
  it("only reports new errors", () => {
    const broken = "function f( {\n"
    expect(newSyntaxErrors("a.ts", broken, broken + "const x = 1\n")).toHaveLength(0)
    expect(newSyntaxErrors("a.ts", "const x = 1\n", "const x = \n")).not.toHaveLength(0)
  })
  it("parses JSX in .js files and JSON with comments in tsconfig", () => {
    expect(newSyntaxErrors("a.js", null, "export const A = () => <div>hi</div>\n")).toHaveLength(0)
    expect(newSyntaxErrors("tsconfig.json", null, '{ // c\n "a": 1, }')).toHaveLength(0)
    expect(newSyntaxErrors("x.json", null, '{ "a": 1, }')).not.toHaveLength(0)
  })
})

describe("misc", () => {
  it("filters rejected files from a patch", () => {
    const p = "diff --git a/a.js b/a.js\n+1\ndiff --git a/b.js b/b.js\n+2\n"
    expect(filterPatch(p, new Set(["a.js"]))).toBe("diff --git a/b.js b/b.js\n+2\n")
  })
  it("redacts tokens", () => {
    expect(redact("x ghp_abcdefghijklmnopqrstuvwxyz0123456789 y")).toBe("x [REDACTED] y")
    for (const key of [
      "AIzaSyD4-abcdefghijklmnopqrstuvwxyz01234",
      "AQ.Ab8RN6Llcxso-PMYZdLEMIes7wb_a3bAtne6vuDyCdl",
      "gsk_abcdefghijklmnopqrstuvwxyz0123",
      "vck_abcdefghijklmnopqrstuvwxyz0123",
      "nvapi-abcdefghijklmnopqrstuvwxyz0123",
      "hf_abcdefghijklmnopqrstuvwxyz0123",
      "sk-or-v1-abcdefghijklmnopqrstuvwxyz",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    ]) {
      expect(redact(`key=${key} end`)).toBe("key=[REDACTED] end")
    }
    expect(redact("Authorization: Bearer abcdefghijklmnop.qrstuvwx")).toBe("Authorization: Bearer [REDACTED]")
    expect(redact("AQ.short and gsk_x stay")).toBe("AQ.short and gsk_x stay") // too short to be keys
    expect(redact("https://x-access-token:abc123@github.com")).toContain("[REDACTED]")
    expect(redact("key sk-proj-abcdefghijklmnopqrstuv")).toBe("key [REDACTED]")
  })
  it("prices cached tokens and enforces caps", async () => {
    expect(costOf("gpt-5-mini", { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.025)
    const dir = mkdtempSync(path.join(os.tmpdir(), "pw-spend-"))
    const l = new SpendLedger(null, dir, 0.05, 0.03)
    await l.record({ taskId: "t", keyOwner: "platform", provider: "openai", model: "gpt-5-mini", purpose: "x", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0.025 })
    await expect(l.assertCanSpend("t", "platform", 0.01)).rejects.toThrow(/task cap/)
    await expect(l.assertCanSpend("u", "platform", 0.03)).rejects.toThrow(/hard stop/)
    await expect(l.assertCanSpend("u", "byok", 0.02)).resolves.toBeUndefined()
    // a fresh ledger over the same audit file sees the earlier spend
    expect(await new SpendLedger(null, dir, 0.05, 0.03).platformSpent()).toBeCloseTo(0.025)
  })
})

describe("parseFailures", () => {
  it("reads node TAP, node spec, vitest and pytest output", () => {
    expect(parseFailures("ok 1 - a\nnot ok 13 - divide by zero throws RangeError\n")).toEqual(["divide by zero throws RangeError"])
    expect(parseFailures("✖ divide by zero throws RangeError (0.69ms)\n✖ failing tests:")).toEqual(["divide by zero throws RangeError"])
    expect(parseFailures(" × src/a.test.ts > adds 3ms")).toEqual(["src/a.test.ts > adds"])
    expect(parseFailures("FAILED tests/test_x.py::test_y - assert")).toEqual(["tests/test_x.py::test_y"])
  })
})

describe("grounding", () => {
  it("flags missing paths and symbols, keeps real ones", async () => {
    execFileSync("git", ["add", "-A"], { cwd: root })
    const g = await groundIssue(ws, "The middleware in `src/middleware/auth.js` should use the existing `RateLimiter` from src/lib/rateLimiter.js. Also `divide()` in src/math.js and https://example.com/a/b.js")
    expect(g.missingPaths.sort()).toEqual(["src/lib/rateLimiter.js", "src/middleware/auth.js"])
    expect(g.missingSymbols).toEqual(["RateLimiter"])
    expect(g.foundPaths).toEqual(["src/math.js"])
  })
  it("treats paths the issue asks to create as new, not missing", async () => {
    const g = await groundIssue(ws, "Put the logic in a new `src/services/export.ts` and create src/lib/fmt.ts. It extends src/lib/old.ts.")
    expect(g.newPaths?.sort()).toEqual(["src/lib/fmt.ts", "src/services/export.ts"])
    expect(g.missingPaths).toEqual(["src/lib/old.ts"])
  })
  it("treats bullet-listed signatures as spec, not missing", async () => {
    const g = await groundIssue(ws, "Add:\n- `signPayload(secret: string, body: string): string` returns the HMAC\n5. `getHook`, `saveHook(url)` in the client\nIt should reuse the existing `LegacySigner`.")
    expect(g.newSymbols?.sort()).toEqual(["getHook", "saveHook", "signPayload"])
    expect(g.missingSymbols).toEqual(["LegacySigner"])
  })
})

describe("route consumer impact analysis", () => {
  it("finds frontend callers of a modified route, ignoring the route file itself", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pw-impact-"))
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir })
    g("init", "-q")
    mkdirSync(path.join(dir, "api"))
    mkdirSync(path.join(dir, "web"))
    writeFileSync(path.join(dir, "api/router.ts"), 'router.get("/tasks", async (req, res) => {\n  res.json(list)\n})\nrouter.get("/stats", h)\n')
    writeFileSync(path.join(dir, "web/client.ts"), "export const listTasks = () => fetch(`${BASE}/api/tasks`)\nexport const stats = () => fetch('/api/stats')\n")
    g("add", "-A")
    g("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "base")
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim()
    writeFileSync(path.join(dir, "api/router.ts"), 'router.get("/tasks", async (req, res) => {\n  res.json({ tasks: list, total })\n})\nrouter.get("/stats", h)\n')
    const ws = new Workspace(dir)
    const hits = await routeConsumers(ws, base, await diffStat(dir, base))
    expect(hits.some((h) => h.startsWith("web/client.ts:1:"))).toBe(true)
    expect(hits.some((h) => h.includes("/api/stats"))).toBe(false) // unchanged route

    // Only a new validation error response: callers are unaffected.
    writeFileSync(path.join(dir, "api/router.ts"), 'router.get("/tasks", async (req, res) => {\n  if (!ok) return res.status(400).json({ error: "bad" })\n  res.json(list)\n})\nrouter.get("/stats", h)\n')
    expect(await routeConsumers(ws, base, await diffStat(dir, base))).toEqual([])
  })
})
