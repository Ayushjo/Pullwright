import { describe, it, expect } from "vitest"
import { parseVerdict } from "../judge.js"

const reqs = ["add the endpoint", "add tests", "update the UI"]
const verdict = (o: object) => JSON.stringify(o)

describe("parseVerdict", () => {
  it("drops requirement ids the checklist doesn't have (the H07 case) and passes when all real ones are met", () => {
    const v = parseVerdict(
      verdict({
        success: false,
        confidence: "low",
        requirements: [
          { id: "R1", met: true, evidence: "a" },
          { id: "R2", met: true, evidence: "b" },
          { id: "R3", met: true, evidence: "c" },
          { id: "R4", met: false },
          { id: "R5", met: false },
        ],
      }),
      reqs,
    )
    expect(v.requirements).toHaveLength(3)
    expect(v.concerns).toEqual([])
    expect(v.success).toBe(true)
  })

  it("still fails when a real requirement is unmet", () => {
    const v = parseVerdict(verdict({ success: false, requirements: [{ id: "R1", met: true }, { id: "R2", met: false, evidence: "no tests" }, { id: "R3", met: true }] }), reqs)
    expect(v.success).toBe(false)
    expect(v.concerns[0]).toBe("Unmet: R2. add tests")
  })

  it("respects a failing verdict with real concerns even if the only unmet ids are phantoms", () => {
    const v = parseVerdict(
      verdict({ success: false, requirements: [{ id: "R1", met: true }, { id: "R2", met: true }, { id: "R3", met: true }, { id: "R9", met: false }], concerns: ["breaks the public API"] }),
      reqs,
    )
    expect(v.success).toBe(false)
    expect(v.concerns).toEqual(["breaks the public API"])
  })

  it("ignores duplicate ids and unparseable output fails closed", () => {
    const v = parseVerdict(verdict({ success: true, requirements: [{ id: "R1", met: true }, { id: "R1", met: false }, { id: "R2", met: true }, { id: "R3", met: true }] }), reqs)
    expect(v.requirements).toHaveLength(3)
    expect(v.success).toBe(true)
    expect(parseVerdict("not json", reqs).success).toBe(false)
  })
})
