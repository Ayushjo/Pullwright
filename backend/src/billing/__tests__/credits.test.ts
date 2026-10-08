import { describe, it, expect } from "vitest"
import { computeBalance, toMicros, type LedgerRow } from "../credits.js"

const d = (iso: string) => new Date(iso)
const row = (kind: LedgerRow["kind"], usd: number, at: string, expires?: string): LedgerRow => ({
  kind,
  amountMicros: toMicros(usd),
  createdAt: d(at),
  expiresAt: expires ? d(expires) : null,
})

describe("computeBalance", () => {
  it("sums credits and subtracts debits", () => {
    const r = computeBalance([row("purchase", 4.25, "2026-10-01"), row("debit", -0.05, "2026-10-02"), row("debit", -0.1, "2026-10-03")], d("2026-10-04"))
    expect(r.balanceMicros).toBe(toMicros(4.1))
    expect(r.overdraftMicros).toBe(0)
  })

  it("spends the credit that expires first, so expiring credit isn't wasted", () => {
    const rows = [
      row("purchase", 4.25, "2026-10-01", "2027-10-01"),
      row("grant", 3, "2026-10-02", "2026-11-02"), // Pro monthly, expires sooner
      row("debit", -1, "2026-10-05"),
    ]
    // On Nov 3 the grant has expired: 2 of its 3 dollars were left and are gone; the pack is untouched.
    expect(computeBalance(rows, d("2026-11-03")).balanceMicros).toBe(toMicros(4.25))
    expect(computeBalance(rows, d("2026-10-10")).balanceMicros).toBe(toMicros(6.25))
  })

  it("expired credit stops counting and can't pay for later spend", () => {
    const rows = [row("trial", 0.2, "2026-10-01", "2026-10-15"), row("debit", -0.05, "2026-10-20")]
    const r = computeBalance(rows, d("2026-10-21"))
    expect(r.overdraftMicros).toBe(toMicros(0.05))
    expect(r.balanceMicros).toBe(-toMicros(0.05))
  })

  it("never lets a debit consume credit granted after it", () => {
    const rows = [row("debit", -0.5, "2026-10-01"), row("purchase", 4.25, "2026-10-02")]
    const r = computeBalance(rows, d("2026-10-03"))
    expect(r.overdraftMicros).toBe(toMicros(0.5))
    expect(r.balanceMicros).toBe(toMicros(3.75))
  })

  it("splits one debit across buckets in expiry order", () => {
    const rows = [row("trial", 0.2, "2026-10-01", "2026-10-15"), row("purchase", 4.25, "2026-10-02", "2027-10-02"), row("debit", -0.3, "2026-10-03")]
    const r = computeBalance(rows, d("2026-10-04"))
    expect(r.buckets.find((b) => b.kind === "trial")).toBeUndefined() // trial fully used
    expect(r.buckets.find((b) => b.kind === "purchase")!.remainingMicros).toBe(toMicros(4.15))
  })

  it("is exact in micro-dollars (no float drift over many small debits)", () => {
    const rows = [row("purchase", 1, "2026-10-01"), ...Array.from({ length: 1000 }, (_, i) => row("debit", -0.000999, `2026-10-02T00:00:${String(i % 60).padStart(2, "0")}Z`))]
    expect(computeBalance(rows, d("2026-10-03")).balanceMicros).toBe(toMicros(1) - 999 * 1000)
  })
})
