import type { SubmittedPlan } from "./tools/index.js"

/**
 * Task size from the plan, not the issue text (docs/architecture/intake.md §13.2): issue-text routers are
 * near random (SWE-Router Route-AUC 0.52–0.57), while our planned-file count tracks cost at r = 0.85.
 * Buckets from 31 gpt-5-mini tasks: 1–2 files median 11 calls / $0.010 (9/9 accepted), 3–4 files 20 calls /
 * $0.037 (8/8), 5+ files 28 calls / $0.089 (10/14). Thresholds are provisional until n ≥ 100.
 */
export type Tier = "S" | "M" | "L"

/** Directories that don't mark a separate package (single-package layouts). */
const COMMON = new Set(["src", "lib", "test", "tests", "__tests__", "spec", "docs", "scripts", "app", "public", "assets", "config"])

export function packagesTouched(files: string[]): string[] {
  const roots = new Set<string>()
  for (const f of files) {
    const parts = f.split("/").filter(Boolean)
    if (parts.length > 1 && !COMMON.has(parts[0]!)) roots.add(parts[0]!)
  }
  return [...roots]
}

export function classifyTier(plan: Pick<SubmittedPlan, "files" | "requirements">): { tier: Tier; reason: string } {
  const files = plan.files.length
  const reqs = plan.requirements.length
  const pkgs = packagesTouched(plan.files.map((f) => f.path))
  if (files >= 5) return { tier: "L", reason: `${files} files` }
  if (reqs > 10) return { tier: "L", reason: `${reqs} requirements` }
  if (pkgs.length >= 2) return { tier: "L", reason: `spans ${pkgs.join(" + ")}` }
  if (files >= 3) return { tier: "M", reason: `${files} files` }
  if (reqs >= 7) return { tier: "M", reason: `${reqs} requirements` }
  return { tier: "S", reason: `${files} file${files === 1 ? "" : "s"}, ${reqs} requirement${reqs === 1 ? "" : "s"}` }
}

/**
 * Executor call cap per tier. M keeps today's 40 (the ladder passes with it); S is ~2.3× its bucket
 * median so a stuck small task stops early; L gets headroom (hard-task p90 was 77 calls end to end).
 */
export const RUN_STEPS: Record<Tier, number> = { S: 25, M: 40, L: 50 }

/** Expected calls and minutes per tier (bucket medians), for the UI and capacity forecasts. */
export const TIER_EXPECT: Record<Tier, { calls: number; label: string }> = {
  S: { calls: 11, label: "Small" },
  M: { calls: 20, label: "Medium" },
  L: { calls: 28, label: "Large" },
}
