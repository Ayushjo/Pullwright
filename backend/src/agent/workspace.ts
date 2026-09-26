import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync, statSync } from "fs"
import { mkdir, readFile, rm, writeFile, unlink } from "fs/promises"
import path from "path"

const execFileP = promisify(execFile)

/** Paths the agent may never read or write. */
const FORBIDDEN = [/^\.git(\/|$)/, /(^|\/)\.env(\..*)?$/]

export class PathError extends Error {}

/**
 * Host-side view of a task's checked-out repository.
 * File tools run here (fast, no container round-trip); shell commands run in the sandbox,
 * which bind-mounts the same directory at /workspace.
 */
export class Workspace {
  constructor(readonly root: string) {}

  /** Accepts `/workspace/x`, `./x`, or `x`. Returns repo-relative posix path. */
  rel(p: string): string {
    let s = (p ?? "").trim().replace(/\\/g, "/")
    if (s.startsWith("/workspace")) s = s.slice("/workspace".length)
    s = s.replace(/^\/+/, "")
    const norm = path.posix.normalize(s || ".")
    if (norm.startsWith("..")) throw new PathError(`Path escapes the repository: ${p}`)
    if (FORBIDDEN.some((re) => re.test(norm))) throw new PathError(`Access to ${norm} is not allowed`)
    return norm === "." ? "" : norm
  }

  abs(p: string): string {
    return path.join(this.root, this.rel(p))
  }

  exists(p: string): boolean {
    return existsSync(this.abs(p))
  }

  isDir(p: string): boolean {
    const a = this.abs(p)
    return existsSync(a) && statSync(a).isDirectory()
  }

  async read(p: string): Promise<string> {
    return readFile(this.abs(p), "utf8")
  }

  async write(p: string, content: string): Promise<void> {
    const a = this.abs(p)
    await mkdir(path.dirname(a), { recursive: true })
    await writeFile(a, content, "utf8")
  }

  async remove(p: string): Promise<void> {
    await unlink(this.abs(p))
  }

  async git(args: string[], opts: { maxBuffer?: number; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
    const { stdout } = await execFileP("git", args, {
      cwd: this.root,
      maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(opts.env ?? {}) },
    })
    return stdout
  }

  /** Tracked + untracked-not-ignored files. */
  async listFiles(): Promise<string[]> {
    const out = await this.git(["ls-files", "--cached", "--others", "--exclude-standard"])
    return [...new Set(out.split("\n").filter(Boolean))].filter((f) => existsSync(path.join(this.root, f)))
  }

  /** Closest existing paths to a (probably hallucinated) path. */
  async suggest(p: string, limit = 5): Promise<string[]> {
    const files = await this.listFiles()
    const want = this.relSafe(p).toLowerCase()
    const base = path.posix.basename(want)
    const stem = base.replace(/\.[^.]+$/, "")
    const scored = files.map((f) => {
      const lf = f.toLowerCase()
      const fb = path.posix.basename(lf)
      let score = 0
      if (fb === base) score += 10
      if (stem && fb.replace(/\.[^.]+$/, "") === stem) score += 6
      if (stem && lf.includes(stem)) score += 3
      for (const seg of want.split("/")) if (seg && lf.includes(seg)) score += 1
      return { f, score }
    })
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.f)
  }

  private relSafe(p: string): string {
    try {
      return this.rel(p)
    } catch {
      return p
    }
  }

  async destroy(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
  }
}
