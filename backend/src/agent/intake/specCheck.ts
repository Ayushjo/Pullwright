import type { ChatFn } from "../../llm/lanes.js"

/**
 * A separate specification check before planning (docs/architecture/intake.md §13.3). Measured: on vague
 * issues gpt-5-mini's planner asked 0 of 5 times and made 4 behaviour-changing guesses it called "low
 * risk"; published work finds a separate intent agent recovers ~full-spec resolve rates (69.4 vs 70.8%)
 * while an agent deciding for itself reaches 61.2%. The underspecification scale is OpenAI's SWE-bench
 * Verified rubric, so our labels are comparable with published numbers.
 */

export type Impact = "blocking" | "behavior" | "cosmetic"

export type SpecQuestion = {
  id: string
  question: string
  options: string[]
  default: string
  impact: Impact
  /** Would reading the repository (tests, callers, conventions, docs) settle it? */
  answerableFromCode: boolean
}

export type SpecCheck = {
  underspec: 0 | 1 | 2 | 3
  kind: "bug" | "feature" | "refactor" | "docs" | "question" | "other"
  questions: SpecQuestion[]
}

export const SPEC_SYSTEM = `You check whether a GitHub issue says clearly enough what change is wanted, before a coding agent plans it. You have not read the code; you get the issue, its attachments as text, which paths/symbols it mentions that do or do not exist in the repository, and the top of a repository map.

Rate "underspec" with this rubric:
0 = The issue is well-specified and it is clear what is required for a successful solution.
1 = There are some blanks to fill in about the issue, but there is a sensible interpretation of what is required for a successful solution.
2 = The issue is vague and there is room for ambiguity. It is unclear what a successful solution would look like.
3 = It is almost impossible to understand what you are being asked to do without further information.

Then list at most 3 open questions whose answers would change the observable result: names of parameters/fields/routes, response or error shapes and status codes, which component or behaviour to change, sync vs async API, what counts as done. Never ask about implementation details the agent can decide, tests, or style. Ask nothing when underspec is 0.
For each question give 2-4 concrete options and a default: the option most consistent with the issue text and ordinary conventions.
impact: "blocking" = work cannot sensibly start (the thing to change does not exist, the request contradicts itself, no identifiable goal); "behavior" = the options produce different observable behaviour; "cosmetic" = naming or wording only.
answerableFromCode: true when reading the repository (existing tests, callers, docs, similar code) would most likely settle it.

Reply with a JSON object only:
{"underspec": 0|1|2|3, "kind": "bug"|"feature"|"refactor"|"docs"|"question"|"other",
 "questions": [{"question": "...", "options": ["...", "..."], "default": "...", "impact": "blocking"|"behavior"|"cosmetic", "answerableFromCode": true|false}]}`

const KINDS = new Set(["bug", "feature", "refactor", "docs", "question", "other"])
const IMPACTS = new Set(["blocking", "behavior", "cosmetic"])

export function parseSpecCheck(text: string): SpecCheck | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: Record<string, unknown>
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const u = Number(j.underspec)
  const underspec = (Number.isInteger(u) && u >= 0 && u <= 3 ? u : 1) as SpecCheck["underspec"]
  const kind = (KINDS.has(String(j.kind)) ? String(j.kind) : "other") as SpecCheck["kind"]
  const raw = Array.isArray(j.questions) ? (j.questions as Record<string, unknown>[]) : []
  const questions: SpecQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== "object") continue
    const question = typeof q.question === "string" ? q.question.trim() : ""
    if (!question) continue
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 4)
    const def = typeof q.default === "string" && q.default.trim() ? q.default.trim() : (options[0] ?? "")
    questions.push({
      id: `Q${questions.length + 1}`,
      question: question.slice(0, 300),
      options: options.map((o) => o.slice(0, 200)),
      default: def.slice(0, 200),
      impact: (IMPACTS.has(String(q.impact)) ? String(q.impact) : "behavior") as Impact,
      answerableFromCode: q.answerableFromCode === true,
    })
    if (questions.length === 3) break
  }
  // A clear issue has nothing to ask; drop stray questions rather than stop anyone.
  return { underspec, kind, questions: underspec === 0 ? [] : questions }
}

export async function specCheck(
  input: { title: string; body: string; comments: string[]; attachments: string; grounding: string; repoMap: string },
  chat: ChatFn,
  taskId: string,
): Promise<SpecCheck | null> {
  const user = [
    `# Issue: ${input.title}`,
    input.body.trim() || "(empty body)",
    input.comments.length ? `## Comments\n${input.comments.join("\n\n").slice(0, 4000)}` : "",
    input.attachments,
    input.grounding ? `## Checked against the repository\n${input.grounding}` : "",
    `## Repository map (top)\n${input.repoMap.slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  const res = await chat({ taskId, purpose: "spec", messages: [{ role: "system", content: SPEC_SYSTEM }, { role: "user", content: user }], maxOutputTokens: 2_000, jsonMode: true })
  return parseSpecCheck(res.text)
}
