import type { Redis } from "ioredis"
import { createRedisClient } from "../config/redis.js"
import { decrypt, encrypt } from "../auth/session.js"
import type { Msg } from "./llm.js"
import type { SubmittedPlan } from "./tools/index.js"
import type { VerifyRun, GateResult } from "./gate.js"
import type { Verdict } from "./judge.js"
import type { FileStat } from "./git.js"

export type TaskStatus =
  | "queued"
  | "preparing"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "needs_input"
  | "validating"
  | "ready"
  | "needs_review"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled"

export const TERMINAL: TaskStatus[] = ["published", "failed", "cancelled"]

export type TaskOptions = {
  autoApprove: boolean
  autoPublish: boolean
  draft: boolean
  model?: string
  /** Which API key pays for this task: the operator's platform key, or the user's own. */
  keyKind?: "platform" | "byok"
  keyProvider?: "openai" | "openrouter"
  /** Per-task spend cap in USD (defaults from TASK_BUDGET_USD, scaled by plan size, raisable by the user). */
  capUsd?: number
}

export type TaskState = {
  taskId: string
  userId?: string
  githubLogin?: string
  issueUrl: string
  /** Eval mode: work on a local git repo with issue text supplied directly (never published). */
  source?: { kind: "local"; repoPath: string }
  owner: string
  repo: string
  issueNumber: number
  title: string
  body: string
  comments: string[]
  status: TaskStatus
  statusDetail?: string
  options: TaskOptions
  defaultBranch?: string
  baseSha?: string
  workDir?: string
  setupCmds?: string[]
  verifyCmds?: string[]
  instructions?: string
  baseline?: VerifyRun[]
  planMessage?: string
  plan?: SubmittedPlan
  planChecklist?: { title: string; status: string }[]
  runMessages?: Msg[]
  pendingQuestion?: string
  summary?: string
  gate?: Omit<GateResult, "stats">
  verdict?: Verdict
  stats?: FileStat[]
  rejectedFiles: string[]
  checkpoints: { label: string; sha: string; at: string }[]
  prUrl?: string
  prBranch?: string
  failureReason?: string
  costUsd: number
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  llmCalls: number
  toolCalls: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

const TTL = 60 * 60 * 24 * 7

let redis: Redis | null = null
function r(): Redis {
  redis ??= createRedisClient()
  return redis
}

const k = {
  state: (id: string) => `pw:task:${id}`,
  patch: (id: string) => `pw:patch:${id}`,
  token: (id: string) => `pw:token:${id}`,
  inbox: (id: string) => `pw:inbox:${id}`,
  cancel: (id: string) => `pw:cancel:${id}`,
  lock: (id: string) => `pw:lock:${id}`,
  counters: (id: string) => `pw:counters:${id}`,
}

export const taskStore = {
  async get(id: string): Promise<TaskState | null> {
    const [raw, counters] = await Promise.all([r().get(k.state(id)), r().hgetall(k.counters(id))])
    if (!raw) return null
    const s = JSON.parse(raw) as TaskState
    // Live counters are kept in their own hash so they never race with state writes.
    for (const key of ["costUsd", "llmCalls", "toolCalls"] as const) {
      const v = Number(counters?.[key])
      if (Number.isFinite(v) && v > (s[key] ?? 0)) s[key] = v
    }
    return s
  },
  async put(s: TaskState): Promise<TaskState> {
    s.updatedAt = new Date().toISOString()
    await r().set(k.state(s.taskId), JSON.stringify(s), "EX", TTL)
    return s
  },
  async patch(id: string, p: Partial<TaskState>): Promise<TaskState> {
    const cur = await this.get(id)
    if (!cur) throw new Error(`Task ${id} not found`)
    return this.put({ ...cur, ...p })
  },
  /** Cheap live counters for the UI without rewriting the whole state from a stale copy. */
  async patchCounters(id: string, c: { costUsd: number; llmCalls: number; toolCalls: number }) {
    await r().multi().hset(k.counters(id), { costUsd: c.costUsd, llmCalls: c.llmCalls, toolCalls: c.toolCalls }).expire(k.counters(id), TTL).exec()
  },
  async savePatch(id: string, patch: string) {
    await r().set(k.patch(id), patch, "EX", TTL)
  },
  async loadPatch(id: string): Promise<string | null> {
    return r().get(k.patch(id))
  },
  /** GitHub token for this task, encrypted at rest (AES-256-GCM), never in job data. */
  async putToken(id: string, token: string) {
    await r().set(k.token(id), encrypt(token), "EX", 60 * 60 * 24)
  },
  async getToken(id: string): Promise<string | undefined> {
    const v = await r().get(k.token(id))
    if (!v) return undefined
    try {
      return decrypt(v)
    } catch {
      return undefined
    }
  },
  async dropToken(id: string) {
    await r().del(k.token(id))
  },
  async pushMessage(id: string, text: string) {
    await r().rpush(k.inbox(id), text)
    await r().expire(k.inbox(id), TTL)
  },
  async drainMessages(id: string): Promise<string[]> {
    const tx = await r().multi().lrange(k.inbox(id), 0, -1).del(k.inbox(id)).exec()
    return ((tx?.[0]?.[1] as string[] | undefined) ?? []).filter(Boolean)
  },
  async cancel(id: string) {
    await r().set(k.cancel(id), "1", "EX", TTL)
  },
  async isCancelled(id: string): Promise<boolean> {
    return (await r().exists(k.cancel(id))) === 1
  },
  async clearCancel(id: string) {
    await r().del(k.cancel(id))
  },
}
