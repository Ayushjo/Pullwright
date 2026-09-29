import { describe, it, expect } from "vitest"
import { classifyTier, packagesTouched } from "../tier.js"

const plan = (paths: string[], reqs = 3) => ({ files: paths.map((path) => ({ path, new: false })), requirements: Array.from({ length: reqs }, (_, i) => `R${i}`) })

describe("classifyTier", () => {
  it("S: 1-2 files, few requirements (L02, L06-style)", () => {
    expect(classifyTier(plan(["src/math.js"], 3)).tier).toBe("S")
    expect(classifyTier(plan(["src/server.js", "test/server.test.js"], 5)).tier).toBe("S")
  })

  it("M: 3-4 files or 7-10 requirements", () => {
    expect(classifyTier(plan(["src/a.js", "src/b.js", "test/a.test.js"])).tier).toBe("M")
    expect(classifyTier(plan(["src/a.js"], 8)).tier).toBe("M")
  })

  it("L: 5+ files, >10 requirements, or two packages", () => {
    expect(classifyTier(plan(["a", "b", "c", "d", "e"].map((x) => `src/${x}.js`))).tier).toBe("L")
    expect(classifyTier(plan(["src/a.js"], 12)).tier).toBe("L")
    const cross = classifyTier(plan(["backend/src/api/router.ts", "frontend/src/pages/History.tsx"]))
    expect(cross).toEqual({ tier: "L", reason: "spans backend + frontend" })
  })

  it("src/ and test/ in one package are not two packages", () => {
    expect(packagesTouched(["src/a.js", "test/a.test.js", "README.md"])).toEqual([])
  })
})
