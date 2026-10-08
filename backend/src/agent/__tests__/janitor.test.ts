import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, existsSync, utimesSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const root = mkdtempSync(path.join(tmpdir(), "pw-janitor-"))
vi.mock("../git.js", () => ({ tasksRoot: () => root }))
vi.mock("../store.js", () => ({ taskStore: { get: async () => null }, TERMINAL: ["published", "failed", "cancelled"] }))
vi.mock("../depCache.js", () => ({ evictDeps: async () => {} }))
vi.mock("../sandbox.js", () => ({ Sandbox: { reapStale: async () => 0 } }))

const { sweepWorkspaces } = await import("../janitor.js")
const old = (dir: string) => {
  const t = new Date(Date.now() - 48 * 3_600_000)
  utimesSync(dir, t, t)
}

describe("janitor", () => {
  beforeEach(() => {
    for (const d of ["scratch", "eval-repos", "0b6f2c1e-1a2b-4c3d-8e9f-001122334455"]) {
      mkdirSync(path.join(root, d), { recursive: true })
      old(path.join(root, d))
    }
  })
  afterEach(() => vi.clearAllMocks())

  it("removes an orphaned task workspace but never scratch/ or eval-repos/", async () => {
    const r = await sweepWorkspaces()
    expect(r.removed).toBe(1)
    expect(existsSync(path.join(root, "0b6f2c1e-1a2b-4c3d-8e9f-001122334455"))).toBe(false)
    expect(existsSync(path.join(root, "scratch"))).toBe(true)
    expect(existsSync(path.join(root, "eval-repos"))).toBe(true)
  })
})
