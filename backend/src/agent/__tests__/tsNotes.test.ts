import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { Workspace } from "../workspace.js"
import { parseJsonc, tsErrorHints, tsSettingsNote } from "../tsNotes.js"

describe("TypeScript settings note", () => {
  it("parses JSONC with comments, URLs in strings and trailing commas", () => {
    expect(parseJsonc('{ // c\n "paths": {"@/*": ["./src/*"]}, /* b */ "url": "http://x//y",\n}')).toEqual({ paths: { "@/*": ["./src/*"] }, url: "http://x//y" })
  })

  it("follows extends and references and lists the enforced rules", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pw-ts-"))
    mkdirSync(path.join(root, "api"))
    mkdirSync(path.join(root, "web"))
    writeFileSync(path.join(root, "tsconfig.base.json"), '{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }')
    writeFileSync(path.join(root, "api/tsconfig.json"), '{ "extends": "../tsconfig.base.json", "compilerOptions": { "module": "NodeNext" } }')
    writeFileSync(path.join(root, "web/tsconfig.json"), '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }')
    writeFileSync(path.join(root, "web/tsconfig.app.json"), '{ "compilerOptions": { "noUnusedLocals": true, } }')
    const note = await tsSettingsNote(new Workspace(root), ["api", "web"])
    expect(note).toContain("- api: `noUncheckedIndexedAccess`")
    expect(note).toContain("`.js` extension")
    expect(note).toMatch(/- web: unused imports/)
    expect(await tsSettingsNote(new Workspace(mkdtempSync(path.join(os.tmpdir(), "pw-ts-")) ), ["."])).toBe("")
  })

  it("maps tsc error codes to fix recipes", () => {
    const out = "a.ts(1,2): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.\nb.tsx(3,4): error TS6133: 'x' is declared but its value is never read."
    const h = tsErrorHints(out)
    expect(h).toContain("possibly `undefined`")
    expect(h).toContain("unused declaration")
    expect(tsErrorHints("all good")).toBe("")
  })
})
