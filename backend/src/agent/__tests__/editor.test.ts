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
import { parseFailures } from "../gate.js"

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
    expect(redact("https://x-access-token:abc123@github.com")).toContain("[REDACTED]")
    expect(redact("key sk-proj-abcdefghijklmnopqrstuv")).toBe("key [REDACTED]")
  })
  it("prices cached tokens and enforces caps", () => {
    expect(costOf("gpt-5-mini", { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.025)
    const dir = mkdtempSync(path.join(os.tmpdir(), "pw-spend-"))
    const l = new SpendLedger(dir, 0.05, 0.03)
    l.record({ taskId: "t", keyOwner: "platform", provider: "openai", model: "gpt-5-mini", purpose: "x", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0.025 })
    expect(() => l.assertCanSpend("t", "platform", 0.01)).toThrow(/task cap/)
    expect(() => l.assertCanSpend("u", "platform", 0.03)).toThrow(/hard stop/)
    expect(() => l.assertCanSpend("u", "byok", 0.02)).not.toThrow()
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
