import os from "os"
import path from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { PassThrough } from "stream"
import type Docker from "dockerode"
import { createDockerClient } from "../config/docker.js"
import logger from "../logger.js"

/**
 * Sandbox provider (shape borrowed from the E2B SDK: create / exec / kill).
 * Docker implementation with codex-style hardening translated to container flags:
 * read-only rootfs, tmpfs /tmp, non-root user, all caps dropped, no-new-privileges,
 * pids/mem/cpu limits, `.git` mounted read-only, and no network outside the setup stage.
 * No GitHub credentials are ever passed into a container.
 */

export const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "pullwright-sandbox:2"

export type ExecResult = { exitCode: number; stdout: string; timedOut: boolean; durationMs: number }

export type SandboxOptions = {
  network: boolean
  readOnlyWorkspace?: boolean
  memoryMb?: number
  cpus?: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function contextDir(): string {
  for (const c of [path.resolve(__dirname, "../../src/sandbox"), path.resolve(__dirname, "../sandbox")]) {
    if (existsSync(path.join(c, "Dockerfile"))) return c
  }
  throw new Error("Sandbox Dockerfile not found")
}

let imageReady: Promise<void> | null = null
async function ensureImage(docker: Docker) {
  imageReady ??= (async () => {
    try {
      await docker.getImage(SANDBOX_IMAGE).inspect()
    } catch {
      logger.info(`Building sandbox image ${SANDBOX_IMAGE}…`)
      const stream = await docker.buildImage({ context: contextDir(), src: ["Dockerfile"] }, { t: SANDBOX_IMAGE })
      await new Promise<void>((resolve, reject) =>
        docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve())),
      )
    }
  })().catch((e) => {
    imageReady = null
    throw e
  })
  return imageReady
}

export class Sandbox {
  private constructor(
    private docker: Docker,
    readonly container: Docker.Container,
    readonly taskId: string,
  ) {}

  static async create(taskId: string, hostRoot: string, opts: SandboxOptions): Promise<Sandbox> {
    const docker = createDockerClient()
    await docker.ping()
    await ensureImage(docker)
    const runtime = process.env.SANDBOX_RUNTIME // e.g. "runsc" for gVisor
    const binds = [`${hostRoot}:/workspace${opts.readOnlyWorkspace ? ":ro" : ""}`]
    if (existsSync(path.join(hostRoot, ".git"))) binds.push(`${path.join(hostRoot, ".git")}:/workspace/.git:ro`)
    const container = await docker.createContainer({
      Image: SANDBOX_IMAGE,
      Cmd: ["sleep", "infinity"],
      WorkingDir: "/workspace",
      User: process.env.SANDBOX_USER ?? "1000:1000",
      Env: ["HOME=/tmp", "CI=1", "GIT_OPTIONAL_LOCKS=0", "PAGER=cat", "npm_config_cache=/tmp/.npm", "NO_COLOR=1"],
      Labels: { "pullwright.task": taskId, "pullwright.worker": WORKER_ID },
      HostConfig: {
        Binds: binds,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,exec,size=768m" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: 256,
        Memory: (opts.memoryMb ?? 1228) * 1024 * 1024,
        MemorySwap: (opts.memoryMb ?? 1228) * 1024 * 1024,
        NanoCpus: Math.round((opts.cpus ?? 1) * 1e9),
        NetworkMode: opts.network ? "bridge" : "none",
        AutoRemove: false,
        ...(runtime ? { Runtime: runtime } : {}),
      },
    })
    await container.start()
    return new Sandbox(docker, container, taskId)
  }

  /** Runs `bash -c cmd` with a hard kill after `timeoutMs`. Output is stdout+stderr interleaved. */
  async exec(cmd: string, timeoutMs = 60_000, cwd = "/workspace"): Promise<ExecResult> {
    const started = Date.now()
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000))
    const exec = await this.container.exec({
      Cmd: ["timeout", "-s", "KILL", String(secs), "bash", "-c", cmd],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: cwd,
    })
    const stream = await exec.start({ hijack: true, stdin: false })
    const out = new PassThrough()
    let buf = ""
    const MAX = 2_000_000
    out.on("data", (c: Buffer) => {
      if (buf.length < MAX) buf += c.toString("utf8")
    })
    this.docker.modem.demuxStream(stream, out, out)
    await Promise.race([
      new Promise<void>((resolve) => {
        stream.on("end", resolve)
        stream.on("close", resolve)
        stream.on("error", () => resolve())
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs + 5_000)),
    ])
    const info = await exec.inspect().catch(() => ({ ExitCode: -1 }))
    const exitCode = info.ExitCode ?? -1
    const timedOut = exitCode === 137 && Date.now() - started >= timeoutMs - 500
    return { exitCode, stdout: buf, timedOut, durationMs: Date.now() - started }
  }

  async destroy() {
    await this.container.remove({ force: true }).catch(() => {})
  }

  /**
   * Remove this worker's containers (all of them, or one task's). Scoped by the worker label so a
   * restarting worker never kills sandboxes that belong to another worker on the same Docker host.
   */
  static async reapAll(taskId?: string) {
    const docker = createDockerClient()
    const list = await docker.listContainers({
      all: true,
      filters: { label: taskId ? [`pullwright.task=${taskId}`] : [`pullwright.worker=${WORKER_ID}`] },
    })
    await Promise.all(list.map((c) => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})))
    return list.length
  }

  /** Safety net for crashed workers: remove any Pullwright container older than `maxAgeMs`. */
  static async reapStale(maxAgeMs: number, now = Date.now()) {
    const docker = createDockerClient()
    const list = await docker.listContainers({ all: true, filters: { label: ["pullwright.task"] } })
    const stale = list.filter((c) => now - c.Created * 1000 > maxAgeMs)
    await Promise.all(stale.map((c) => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})))
    return stale.length
  }
}

/**
 * Stable identity of this worker process: set WORKER_ID per worker (e.g. the systemd instance name)
 * when several workers share one Docker host; defaults to hostname + WORKER_SLOT.
 */
export const WORKER_ID = process.env.WORKER_ID ?? `${os.hostname()}-${process.env.WORKER_SLOT ?? "0"}`

/** Head + tail truncation (mini-swe-agent / cline style). */
export function truncateOutput(s: string, max = 8_000): string {
  if (s.length <= max) return s
  const half = Math.floor(max / 2)
  return (
    s.slice(0, half) +
    `\n\n<${s.length - max} characters elided — output too long. Use grep/head/tail or a narrower command.>\n\n` +
    s.slice(-half)
  )
}
