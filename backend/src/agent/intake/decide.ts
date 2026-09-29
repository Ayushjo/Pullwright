import type { SpecCheck, SpecQuestion } from "./specCheck.js"

/**
 * Ask or assume — decided in code, not by the model (docs/architecture/intake.md §13.3):
 * - stop and ask only when work cannot sensibly start: underspec 3, or a blocking question the code
 *   can't answer. That spends no planner calls on a guess.
 * - everything else goes to the planner as open questions: it settles what the code can answer and
 *   records the rest as assumptions the user sees (and can change) at plan approval.
 */
export type Decision = { action: "ask"; questions: SpecQuestion[]; reason: string } | { action: "plan"; open: SpecQuestion[] }

export function decide(spec: SpecCheck | null): Decision {
  if (!spec) return { action: "plan", open: [] } // the check failed: plan as before
  const blocking = spec.questions.filter((q) => q.impact === "blocking" && !q.answerableFromCode)
  if (spec.underspec === 3 || blocking.length) {
    const questions = blocking.length ? blocking : spec.questions
    return {
      action: "ask",
      questions,
      reason: spec.underspec === 3 ? "The issue doesn't say what change is wanted." : "The issue can't be implemented as written without an answer.",
    }
  }
  return { action: "plan", open: spec.questions }
}

/** One message with lettered options, for the needs_input banner and a GitHub comment. */
export function formatQuestions(questions: SpecQuestion[], reason?: string): string {
  const body = questions
    .map((q, i) => {
      const opts = q.options.map((o, j) => `   ${String.fromCharCode(97 + j)}) ${o}${o === q.default ? "  (default)" : ""}`).join("\n")
      return `${i + 1}. ${q.question}${opts ? `\n${opts}` : ""}`
    })
    .join("\n")
  return [reason, body].filter(Boolean).join("\n\n")
}

/** Open questions for the planner: settle from the code where possible, otherwise take the default. */
export function openQuestionsBlock(open: SpecQuestion[]): string {
  if (!open.length) return ""
  const lines = open.map((q) => `${q.id} (${q.impact}${q.answerableFromCode ? ", likely answerable from the code" : ""}): ${q.question}\n   options: ${q.options.join(" | ")}\n   default: ${q.default}`)
  return `## Open questions from the specification check
Settle each one before planning. If the repository answers it (existing tests, callers, types, conventions, docs), follow the code and cite file:line as evidence. Otherwise take the default. Record every one in "assumptions".
${lines.join("\n")}`
}
