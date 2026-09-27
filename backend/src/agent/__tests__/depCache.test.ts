import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, utimesSync } from "fs"
import os from "os"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const states = new Map<string, { status: string; updatedAt: string }>()
vi.mock("../store.js", () => ({
  TERMINAL: ["published", "failed", "cancelled"],
  taskStore: { get: async (id: string) => states.get(id) ?? null },
}))

const { cacheableInstall, depKey, restoreDeps, saveDeps, evictDeps } = await import("../depCache.js")
const { sweepWorkspaces } = await import("../janitor.js")

function pkg(root: string, dir: string, lock = '{"lockfileVersion":3}') {
  const d = path.join(root, dir)
  mkdirSync(path.join(d, "node_modules", "left-pad"), { recursive: true })
  writeFileSync(path.join(d, "package.json"), '{"name":"x","dependencies":{"left-pad":"1"}}')
  writeFileSync(path.join(d, "package-lock.json"), lock)
  writeFileSync(path.join(d, "node_modules", "left-pad", "index.js"), "module.exports = 1\n")
  return d
}

describe("dependency cache", () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "pw-dep-"))
    process.env.DEP_CACHE_DIR = path.join(base, "cache")
  })

  it("recognizes lockfile installs only", () => {
    expect(cacheableInstall("cd web && npm ci --no-audit")).toEqual({ dir: "web", install: "npm ci --no-audit" })
    expect(cacheableInstall("corepack pnpm install --frozen-lockfile")).toEqual({ dir: ".", install: "corepack pnpm install --frozen-lockfile" })
    expect(cacheableInstall("npm install --no-audit")).toBeNull()
    expect(cacheableInstall("npx prisma generate")).toBeNull()
  })

  it("keys on repo and lockfile; no lockfile → no key", async () => {
    const root = path.join(base, "repo")
    pkg(root, "api")
    const a = await depKey("o/r", root, "api", "npm ci")
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(await depKey("o/other", root, "api", "npm ci")).not.toBe(a) // no cross-repo sharing
    writeFileSync(path.join(root, "api", "package-lock.json"), '{"lockfileVersion":3,"x":1}')
    expect(await depKey("o/r", root, "api", "npm ci")).not.toBe(a)
    mkdirSync(path.join(root, "nolock"))
    writeFileSync(path.join(root, "nolock", "package.json"), "{}")
    expect(await depKey("o/r", root, "nolock", "npm install")).toBeNull()
  })

  it("saves and restores node_modules; misses cleanly", async () => {
    const src = pkg(path.join(base, "a"), ".")
    const key = (await depKey("o/r", src, ".", "npm ci"))!
    expect(await restoreDeps(key, path.join(base, "b"))).toBe(false)
    await saveDeps(key, src, "o/r")
    const dst = path.join(base, "b")
    mkdirSync(dst)
    expect(await restoreDeps(key, dst)).toBe(true)
    expect(readFileSync(path.join(dst, "node_modules", "left-pad", "index.js"), "utf8")).toContain("module.exports")
  })

  it("evicts least recently used entries over the cap", async () => {
    const k1 = (await depKey("o/one", pkg(path.join(base, "1"), "."), ".", "npm ci"))!
    await saveDeps(k1, path.join(base, "1"), "o/one")
    const k2 = (await depKey("o/two", pkg(path.join(base, "2"), "."), ".", "npm ci"))!
    await saveDeps(k2, path.join(base, "2"), "o/two")
    const old = new Date(Date.now() - 60_000)
    utimesSync(path.join(base, "cache", k1), old, old)
    await evictDeps(1) // 1 byte: keep evicting until under the cap
    expect(existsSync(path.join(base, "cache", k1))).toBe(false)
  })
})

describe("workspace janitor", () => {
  it("removes finished workspaces, slims idle ones, keeps active ones", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pw-jan-"))
    process.env.TASKS_DIR = root
    process.env.DEP_CACHE_DIR = path.join(root, "..", `cache-${path.basename(root)}`)
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString()
    for (const [id, status] of [["done", "published"], ["idle", "ready"], ["live", "running"]] as const) {
      pkg(path.join(root, id, "repo"), "web")
      states.set(id, { status, updatedAt: old })
    }
    const r = await sweepWorkspaces()
    expect(r).toEqual({ removed: 1, slimmed: 1 })
    expect(existsSync(path.join(root, "done"))).toBe(false)
    expect(existsSync(path.join(root, "idle", "repo", "web", "package.json"))).toBe(true)
    expect(existsSync(path.join(root, "idle", "repo", "web", "node_modules"))).toBe(false)
    expect(existsSync(path.join(root, "live", "repo", "web", "node_modules"))).toBe(true)
  })
})
