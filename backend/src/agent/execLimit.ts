import os from "node:os"

/**
 * At most N sandbox commands run at once in this worker process (FIFO). Each sandbox already has its
 * own CPU and memory limits; this stops several tasks' installs and test suites from running at the
 * same moment and starving each other (and the host), which turned into spurious timeouts.
 * SANDBOX_MAX_EXEC (default: CPUs − 1, at least 1).
 */
export class Semaphore {
  private active = 0
  private queue: (() => void)[] = []
  constructor(readonly max: number) {}

  get running() {
    return this.active
  }
  get waiting() {
    return this.queue.length
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) this.active++
    else await new Promise<void>((resolve) => this.queue.push(resolve)) // the releaser hands its slot over
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<{ value: T; waitedMs: number }> {
    const t0 = Date.now()
    const release = await this.acquire()
    const waitedMs = Date.now() - t0
    try {
      return { value: await fn(), waitedMs }
    } finally {
      release()
    }
  }
}

const configured = Number(process.env.SANDBOX_MAX_EXEC)
export const execLimit = new Semaphore(Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : Math.max(1, os.cpus().length - 1))
