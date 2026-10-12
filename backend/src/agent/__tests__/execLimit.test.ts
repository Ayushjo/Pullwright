import { describe, it, expect } from "vitest"
import { Semaphore } from "../execLimit.js"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("exec limit", () => {
  it("never runs more than max at once, and serves waiters in order", async () => {
    const s = new Semaphore(2)
    let now = 0
    let peak = 0
    const order: number[] = []
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        s.run(async () => {
          now++
          peak = Math.max(peak, now)
          order.push(i)
          await sleep(10)
          now--
        }),
      ),
    )
    expect(peak).toBe(2)
    expect(order).toEqual([0, 1, 2, 3, 4])
    expect(s.running).toBe(0)
    expect(s.waiting).toBe(0)
  })

  it("frees the slot when the command throws, and reports time spent waiting", async () => {
    const s = new Semaphore(1)
    const first = s.run(async () => {
      await sleep(30)
      throw new Error("boom")
    })
    const second = s.run(async () => "ok")
    await expect(first).rejects.toThrow("boom")
    const r = await second
    expect(r.value).toBe("ok")
    expect(r.waitedMs).toBeGreaterThanOrEqual(25)
    expect(s.running).toBe(0)
  })

  it("a release called twice doesn't free a second slot", async () => {
    const s = new Semaphore(1)
    const release = await s.acquire()
    release()
    release()
    await s.acquire()
    expect(s.running).toBe(1)
  })
})
