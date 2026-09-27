import { createHash, randomBytes } from "crypto"
import { execFile } from "child_process"
import { existsSync } from "fs"
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import logger from "../logger.js"
import { tasksRoot } from "./git.js"
import { SANDBOX_IMAGE } from "./sandbox.js"

const execFileP = promisify(execFile)

/**
 * Dependency cache: a snapshot of node_modules after a successful lockfile install, keyed by
 * repo + package dir + install command + lockfile/manifest contents + sandbox image. A restore is a
 * copy-on-write clone (APFS / reflink filesystems) or a plain copy — seconds instead of a minute of npm ci.
 *
 * The repo is part of the key on purpose: a root `postinstall` script can modify node_modules, and a
 * shared cross-repo cache would let one repo poison another's dependencies.
 */

const VERSION = "1"
const INSTALL_RE = /^(?:cd (\S+) && )?((?:npm ci|corepack pnpm install --frozen-lockfile|corepack yarn install --frozen-lockfile)\b.*)$/
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
const KEY_FILES = ["package.json", ...LOCKFILES, ".npmrc", ".yarnrc.yml", "pnpm-workspace.yaml"]

export function cacheRoot(): string {
  return process.env.DEP_CACHE_DIR ?? path.join(path.dirname(path.resolve(tasksRoot())), ".depcache")
}
const maxBytes = () => Number(process.env.DEP_CACHE_MAX_GB ?? 8) * 1024 ** 3

/** `cd web && npm ci …` → { dir: "web", install: "npm ci …" }; null for commands we don't cache. */
export function cacheableInstall(cmd: string): { dir: string; install: string } | null {
  const m = cmd.trim().match(INSTALL_RE)
  return m ? { dir: m[1] ?? ".", install: m[2]! } : null
}

export async function depKey(scope: string, root: string, dir: string, install: string): Promise<string | null> {
  const h = createHash("sha256").update(`${VERSION}\0${SANDBOX_IMAGE}\0${scope}\0${dir}\0${install}\0`)
  let hasLock = false
  for (const f of KEY_FILES) {
    const p = path.join(root, dir, f)
    if (!existsSync(p)) continue
    if (LOCKFILES.includes(f)) hasLock = true
    h.update(`${f}\0`).update(await readFile(p)).update("\0")
  }
  return hasLock ? h.digest("hex").slice(0, 32) : null
}

async function copyTree(src: string, dst: string) {
  // Clone (copy-on-write) where the filesystem supports it; symlinks are preserved either way.
  if (process.platform === "darwin") await execFileP("cp", ["-Rc", src, dst])
  else await execFileP("cp", ["-a", "--reflink=auto", src, dst])
}

/** Restore node_modules into `pkgDir`. Returns false on a cache miss. */
export async function restoreDeps(key: string, pkgDir: string): Promise<boolean> {
  const entry = path.join(cacheRoot(), key)
  const src = path.join(entry, "node_modules")
  if (!existsSync(src)) return false
  const dst = path.join(pkgDir, "node_modules")
  try {
    await rm(dst, { recursive: true, force: true })
    await copyTree(src, dst)
    const now = new Date()
    await utimes(entry, now, now) // LRU
    return true
  } catch (err) {
    logger.warn(`dep cache restore failed (${key}): ${(err as Error).message}`)
    await rm(dst, { recursive: true, force: true }).catch(() => {})
    return false
  }
}

/** Snapshot `pkgDir/node_modules` under `key` (atomic rename), then evict down to the size cap. */
export async function saveDeps(key: string, pkgDir: string, scope: string): Promise<void> {
  const root = cacheRoot()
  const entry = path.join(root, key)
  const src = path.join(pkgDir, "node_modules")
  if (existsSync(entry) || !existsSync(src)) return
  await mkdir(root, { recursive: true })
  const tmp = path.join(root, `.tmp-${key}-${randomBytes(4).toString("hex")}`)
  try {
    await mkdir(tmp)
    await copyTree(src, path.join(tmp, "node_modules"))
    const { stdout } = await execFileP("du", ["-sk", tmp])
    const bytes = Number(stdout.split(/\s/)[0]) * 1024
    await writeFile(path.join(tmp, "meta.json"), JSON.stringify({ scope, bytes, savedAt: new Date().toISOString() }))
    await rename(tmp, entry)
  } catch (err) {
    logger.warn(`dep cache save failed (${key}): ${(err as Error).message}`)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
  await evictDeps().catch((err) => logger.warn(`dep cache eviction failed: ${(err as Error).message}`))
}

/** Least-recently-used eviction to DEP_CACHE_MAX_GB; also clears abandoned temp dirs. */
export async function evictDeps(limit = maxBytes()): Promise<void> {
  const root = cacheRoot()
  if (!existsSync(root)) return
  const entries: { dir: string; bytes: number; used: number }[] = []
  for (const name of await readdir(root)) {
    const dir = path.join(root, name)
    const st = await stat(dir).catch(() => null)
    if (!st?.isDirectory()) continue
    if (name.startsWith(".tmp-")) {
      if (Date.now() - st.mtimeMs > 3_600_000) await rm(dir, { recursive: true, force: true })
      continue
    }
    const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8").catch(() => "{}")) as { bytes?: number }
    entries.push({ dir, bytes: meta.bytes ?? 0, used: st.mtimeMs })
  }
  let total = entries.reduce((a, e) => a + e.bytes, 0)
  for (const e of entries.sort((a, b) => a.used - b.used)) {
    if (total <= limit) break
    await rm(e.dir, { recursive: true, force: true })
    total -= e.bytes
  }
}
