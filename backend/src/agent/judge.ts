import { chat, type ModelSpec } from "./llm.js"
import { JUDGE_SYSTEM } from "./prompts.js"

export type Verdict = { success: boolean; confidence: "low" | "medium" | "high"; explanation: string; concerns: string[] }

/** OpenHands-resolver-style success check: issue + patch + agent summary → verdict. One cheap call. */
export async function judgePatch(
  spec: ModelSpec,
  taskId: string,
  input: { title: string; body: string; plan: string; summary: string; patch: string; verify: string },
  onUsage?: (u: { costUsd: number; model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; durationMs: number }) => void,
): Promise<Verdict> {
  const patch = input.patch.length > 24_000 ? input.patch.slice(0, 24_000) + "\n… (patch truncated)" : input.patch
  const user = [
    `# Issue: ${input.title}`,
    input.body.slice(0, 5000) || "(no description)",
    `\n# Approved plan\n${input.plan}`,
    `\n# Agent's summary\n${input.summary.slice(0, 2000)}`,
    `\n# Verification results\n${input.verify || "(none detected)"}`,
    `\n# Patch\n\`\`\`diff\n${patch}\n\`\`\``,
  ].join("\n")
  const res = await chat(spec, {
    taskId,
    purpose: "judge",
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: user },
    ],
    maxOutputTokens: 2500,
    ...(onUsage ? { onUsage: (u) => onUsage({ ...u }) } : {}),
  })
  const m = res.text.match(/\{[\s\S]*\}/)
  try {
    const j = JSON.parse(m ? m[0] : res.text) as Partial<Verdict>
    return {
      success: Boolean(j.success),
      confidence: j.confidence === "high" || j.confidence === "medium" ? j.confidence : "low",
      explanation: String(j.explanation ?? "").slice(0, 1200),
      concerns: Array.isArray(j.concerns) ? j.concerns.map(String).slice(0, 6) : [],
    }
  } catch {
    return { success: false, confidence: "low", explanation: "Reviewer output could not be parsed.", concerns: [res.text.slice(0, 300)] }
  }
}
