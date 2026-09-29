import { chat, type ModelSpec } from "./llm.js"
import { JUDGE_SYSTEM } from "./prompts.js"

export type Verdict = {
  success: boolean
  confidence: "low" | "medium" | "high"
  explanation: string
  concerns: string[]
  requirements?: { item: string; met: boolean; evidence: string }[]
}

/** OpenHands-resolver-style success check: issue + patch + agent summary → verdict. One cheap call. */
export async function judgePatch(
  spec: ModelSpec,
  taskId: string,
  input: { title: string; body: string; plan: string; requirements: string[]; summary: string; patch: string; verify: string; capUsd?: number },
  onUsage?: (u: { costUsd: number; model: string; provider: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; durationMs: number }) => void,
): Promise<Verdict> {
  const patch = input.patch.length > 24_000 ? input.patch.slice(0, 24_000) + "\n… (patch truncated)" : input.patch
  const user = [
    `# Issue: ${input.title}`,
    input.body.slice(0, 5000) || "(no description)",
    `\n# Approved plan\n${input.plan}`,
    input.requirements.length ? `\n# Requirements checklist\n${input.requirements.map((r, i) => `R${i + 1}. ${r}`).join("\n")}` : "",
    `\n# Agent's summary\n${input.summary.slice(0, 2000)}`,
    `\n# Verification results\n${input.verify || "(none detected)"}`,
    `\n# Patch\n\`\`\`diff\n${patch}\n\`\`\``,
  ].join("\n")
  const res = await chat(spec, {
    taskId,
    purpose: "judge",
    ...(input.capUsd !== undefined ? { taskCapUsd: input.capUsd } : {}),
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: user },
    ],
    maxOutputTokens: 12000,
    jsonMode: true,
    ...(onUsage ? { onUsage: (u) => onUsage({ ...u }) } : {}),
  })
  return parseVerdict(res.text, input.requirements)
}

/**
 * Turn the reviewer's JSON into a verdict. Requirement ids are mapped back to the checklist; ids that
 * are not in the checklist are dropped (seen live: every one of 10 requirements met, plus invented
 * "R11–R14" with no text marked unmet — the task was held and a fix round + repair pass chased
 * requirements that didn't exist). If the only unmet entries were such phantoms and the reviewer
 * raised no other concern, the verdict passes.
 */
export function parseVerdict(text: string, requirements: string[]): Verdict {
  const m = text.match(/\{[\s\S]*\}/)
  try {
    const j = JSON.parse(m ? m[0] : text) as Partial<Verdict>
    const seen = new Set<number>()
    let phantoms = 0
    const reqs: NonNullable<Verdict["requirements"]> = []
    if (Array.isArray(j.requirements)) {
      ;(j.requirements as { id?: string; item?: string; met?: boolean; evidence?: string }[]).forEach((r, i) => {
        const n = Number(String(r.id ?? "").replace(/\D/g, "")) || i + 1
        const known = requirements.length === 0 || (n >= 1 && n <= requirements.length)
        if (!known) {
          if (!r.met) phantoms++
          return
        }
        if (seen.has(n)) return
        seen.add(n)
        reqs.push({ item: r.item ?? `R${n}. ${requirements[n - 1] ?? ""}`, met: Boolean(r.met), evidence: String(r.evidence ?? "") })
      })
    }
    const unmet = reqs.filter((r) => !r.met)
    const concerns = Array.isArray(j.concerns) ? j.concerns.map(String).filter((c) => c.trim()) : []
    const allRealMet = unmet.length === 0 && (requirements.length === 0 || seen.size > 0)
    const onlyPhantoms = !j.success && phantoms > 0 && allRealMet && concerns.length === 0
    return {
      requirements: reqs,
      success: (Boolean(j.success) || onlyPhantoms) && unmet.length === 0,
      confidence: j.confidence === "high" || j.confidence === "medium" ? j.confidence : "low",
      explanation: String(j.explanation ?? "").slice(0, 1200),
      concerns: [...unmet.map((r) => `Unmet: ${r.item}`), ...concerns].slice(0, 8),
    }
  } catch {
    return { success: false, confidence: "low", explanation: "Reviewer output could not be parsed.", concerns: [text.slice(0, 300)] }
  }
}
