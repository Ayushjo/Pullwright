import { describe, it, expect } from "vitest"
import { parseSpecCheck, type SpecCheck } from "../intake/specCheck.js"
import { decide, formatQuestions, openQuestionsBlock } from "../intake/decide.js"

const q = (impact: "blocking" | "behavior" | "cosmetic", answerableFromCode = false) => ({
  id: "Q1", question: "Which filters?", options: ["?author= and ?tag=", "a single ?q= search"], default: "?author= and ?tag=", impact, answerableFromCode,
})
const spec = (underspec: SpecCheck["underspec"], questions = [q("behavior")]): SpecCheck => ({ underspec, kind: "feature", questions })

describe("decide: ask only when work can't sensibly start", () => {
  it("a clear or fillable issue goes to the planner with its open questions", () => {
    expect(decide(spec(1))).toEqual({ action: "plan", open: [q("behavior")] })
    expect(decide(spec(2, [q("behavior"), q("cosmetic")]))).toMatchObject({ action: "plan" })
  })

  it("a blocking question the code can't answer stops for the user (L09: files that don't exist)", () => {
    const d = decide(spec(2, [q("behavior"), q("blocking")]))
    expect(d).toMatchObject({ action: "ask", questions: [q("blocking")] })
  })

  it("an issue rated 0-1 ('a sensible interpretation exists') never stops, even with a blocking question", () => {
    expect(decide(spec(1, [q("blocking")]))).toMatchObject({ action: "plan", open: [q("blocking")] })
  })

  it("a blocking question the code can answer is left to the planner", () => {
    expect(decide(spec(2, [q("blocking", true)]))).toMatchObject({ action: "plan" })
  })

  it("underspec 3 asks everything it has", () => {
    expect(decide(spec(3, [q("behavior")]))).toMatchObject({ action: "ask", questions: [q("behavior")] })
  })

  it("a failed check plans as before", () => {
    expect(decide(null)).toEqual({ action: "plan", open: [] })
  })
})

describe("parseSpecCheck", () => {
  it("normalises fields, numbers questions, caps at 3", () => {
    const text = JSON.stringify({
      underspec: 2, kind: "feature",
      questions: [1, 2, 3, 4].map((i) => ({ question: `q${i}?`, options: ["a", "b"], impact: i === 1 ? "weird" : "behavior", answerableFromCode: i === 2 })),
    })
    const s = parseSpecCheck(`Here you go: ${text}`)!
    expect(s.questions.map((x) => [x.id, x.impact, x.answerableFromCode, x.default])).toEqual([
      ["Q1", "behavior", false, "a"],
      ["Q2", "behavior", true, "a"],
      ["Q3", "behavior", false, "a"],
    ])
  })

  it("a well-specified issue (0) asks nothing even if the model listed questions", () => {
    expect(parseSpecCheck(JSON.stringify({ underspec: 0, kind: "bug", questions: [{ question: "x?", options: ["a"] }] }))!.questions).toEqual([])
  })

  it("garbage → null", () => {
    expect(parseSpecCheck("not json")).toBeNull()
  })
})

describe("formatting", () => {
  it("lettered options with the default marked; planner block asks for evidence", () => {
    expect(formatQuestions([q("blocking")], "Can't start.")).toBe("Can't start.\n\n1. Which filters?\n   a) ?author= and ?tag=  (default)\n   b) a single ?q= search")
    expect(openQuestionsBlock([q("behavior", true)])).toContain("Q1 (behavior, likely answerable from the code): Which filters?")
    expect(openQuestionsBlock([])).toBe("")
  })
})
