import { describe, it, expect } from "vitest"
import { splitBlocked } from "../tools/index.js"

describe("splitBlocked: only a real question stops the task", () => {
  it("keeps a genuine clarification question", () => {
    const q = "The issue refers to src/middleware/auth.js which does not exist. Should I create it?"
    expect(splitBlocked("", q)).toEqual({ blocked: q })
  })

  it("moves a non-answer into risks (gpt-5.4-nano on H06)", () => {
    const b = "No blocking issues identified after inspecting the router; however, the DB branch ignores the params."
    expect(splitBlocked("DB branch returns a bare array", b)).toEqual({ risks: `DB branch returns a bare array\n${b}` })
    expect(splitBlocked("", "None")).toEqual({ risks: "None" })
    expect(splitBlocked("", "N/A")).toEqual({ risks: "N/A" })
  })

  it("drops empty values", () => {
    expect(splitBlocked("  ", "")).toEqual({})
    expect(splitBlocked(undefined, undefined)).toEqual({})
  })
})
