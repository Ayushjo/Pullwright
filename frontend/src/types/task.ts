export type TaskStatus =
  | 'queued' | 'planning' | 'running' | 'verifying' | 'done' | 'failed'
  | 'preparing' | 'awaiting_approval' | 'needs_input' | 'validating'
  | 'ready' | 'needs_review' | 'parked' | 'publishing' | 'published' | 'cancelled'
  /** Display only: a run whose working state expired (read-only). */
  | 'archived'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed'

export type Step = {
  id: number
  title?: string
  description: string
  status: StepStatus
}

export type PhaseMetrics = {
  durationMs: number
  model?: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export type TaskMetricsSnapshot = {
  inputTokens: number
  outputTokens: number
  costUsd: number
  shadowCostUsd: number
  llmCalls: number
  toolCalls: number
  retries: number
  routerRetries?: number
  providerFailovers?: number
  durationMs: number
  phases: Record<string, PhaseMetrics>
  budgetUsedUsd?: number
  budgetLimitUsd?: number
  budgetRemainingUsd?: number
  orgBudgetRemainingUsd?: number
}

export type VerificationResult = {
  passed: boolean
  reason: string
  layer?: string
}

export type TaskEvent =
  | { type: 'phase_start'; phase: string; timestamp?: string }
  | { type: 'phase_end'; phase: string; metrics: PhaseMetrics; timestamp?: string }
  | { type: 'step_start'; step: Step; timestamp?: string }
  | { type: 'step_done'; result: { success: boolean; output: string }; verification: VerificationResult; timestamp?: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; stepId?: number; timestamp?: string }
  | { type: 'tool_result'; tool: string; success: boolean; output: string; durationMs: number; stepId?: number; timestamp?: string }
  | { type: 'llm_call'; agent: string; model: string; provider: string; tokens: { in: number; out: number; cached?: number }; costUsd: number; durationMs: number; timestamp?: string }
  | { type: 'agent_thought'; agent: string; status: 'thinking' | 'reasoning'; text: string; model?: string; provider?: string; timestamp?: string }
  | { type: 'metrics_update'; metrics: TaskMetricsSnapshot; timestamp?: string }
  | { type: 'task_complete'; prUrl?: string; metrics: TaskMetricsSnapshot; timestamp?: string }
  | { type: 'task_failed'; reason: string; metrics?: TaskMetricsSnapshot; timestamp?: string }
  | { type: 'status'; status: TaskStatus; detail?: string; timestamp?: string }
  | { type: 'plan_ready'; plan: Plan; timestamp?: string }
  | { type: 'plan_update'; steps: ChecklistItem[]; timestamp?: string }
  | { type: 'question'; question: string; timestamp?: string }
  | { type: 'parked'; stage: 'plan' | 'run'; until: number | null; reason: string; timestamp?: string }
  | { type: 'resumed'; stage: string; timestamp?: string }
  | { type: 'user_message'; text: string; timestamp?: string }
  | { type: 'notice'; level: 'info' | 'warn'; message: string; timestamp?: string }
  | { type: 'gate_result'; ok: boolean; problems: string[]; warnings: string[]; verify: { cmd: string; before: number | null; after: number }[]; timestamp?: string }
  | { type: 'judge_result'; success: boolean; confidence: string; explanation: string; concerns: string[]; requirements?: RequirementCheck[]; timestamp?: string }
  | { type: 'diff_ready'; files: DiffStat[]; timestamp?: string }
  | { type: 'checkpoint'; label: string; sha: string; timestamp?: string }
  | { type: 'cost'; costUsd: number; llmCalls: number; capUsd: number; timestamp?: string }
  | { type: 'pr_opened'; prUrl: string; timestamp?: string }

export type Assumption = {
  question: string
  chosen: string
  alternatives: string[]
  evidence: string
  impact: 'blocking' | 'behavior' | 'cosmetic'
}

export type Plan = {
  summary: string
  requirements?: string[]
  steps: { title: string; files: string[] }[]
  files: { path: string; new: boolean }[]
  assumptions?: Assumption[]
  tier?: 'S' | 'M' | 'L'
  tierReason?: string
  risks?: string
  blocked?: string
}

export type IntakeAttachment = {
  n: number
  where: string
  kind: 'image' | 'video' | 'file' | 'unknown'
  alt: string
  context: string
  hasImage: boolean
  skipped?: string
  description?: string
  vision?: { kind: string; visibleText: string; whatLooksWrong: string; confidence: string }
}

export type Intake = {
  attachments: IntakeAttachment[]
  spec: { underspec: 0 | 1 | 2 | 3; kind: string; questions: { id: string; question: string; options: string[]; default: string; impact: string }[] } | null
  decision: 'ask' | 'plan'
}

export type ChecklistItem = { title: string; status: 'pending' | 'in_progress' | 'completed' | string }
export type RequirementCheck = { item: string; met: boolean; evidence: string }
export type DiffStat = { path: string; added: number; removed: number; status: 'A' | 'M' | 'D' | 'R' | string }

/** Client-safe task state returned by GET /api/task/:id (v2). */
export type TaskState = {
  taskId: string
  issueUrl: string
  owner: string
  repo: string
  issueNumber: number
  title: string
  body: string
  status: TaskStatus
  statusDetail?: string
  options: { autoApprove: boolean; autoPublish: boolean; draft: boolean }
  defaultBranch?: string
  verifyCmds?: string[]
  baseline?: { cmd: string; exitCode: number }[]
  plan?: Plan
  planChecklist?: ChecklistItem[]
  pendingQuestion?: string
  /** Set while the task waits for model quota (until = epoch ms) or for a key/credits (until = null). */
  park?: { stage: 'plan' | 'run'; until: number | null; reason: string; since: string; count: number }
  intake?: Intake
  summary?: string
  gate?: { ok: boolean; problems: string[]; warnings: string[]; verify: { cmd: string; before: number | null; after: number; output: string; newFailures: string[]; fixed: string[] }[] }
  verdict?: { success: boolean; confidence: string; explanation: string; concerns: string[]; requirements?: RequirementCheck[] }
  stats?: DiffStat[]
  rejectedFiles: string[]
  checkpoints: { label: string; sha: string; at: string }[]
  prUrl?: string
  prBranch?: string
  failureReason?: string
  costUsd: number
  capUsd: number
  stoppedByBudget?: boolean
  stoppedEarly?: boolean
  llmCalls: number
  toolCalls: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  source?: { kind: 'local' }
  /** Loaded from the database after the run's working state was cleaned up: read-only. */
  archived?: boolean
}

export type Task = {
  id: string
  issueUrl: string
  issueTitle: string
  issueNumber: number
  repoName: string
  branchName: string
  status: TaskStatus
  steps: Step[]
  createdAt: string
  elapsedSeconds?: number
  prUrl?: string
}

export type TaskRegistryEntry = {
  taskId: string
  issueUrl: string
  issueTitle: string
  issueNumber: number
  status: TaskStatus
  createdAt: string
  updatedAt: string
  prUrl?: string
}
