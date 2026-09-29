import { createHash } from "crypto"
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions"
import { chat, type ModelSpec, type Msg, type LLMResult } from "./llm.js"
import { SpendLimitError } from "./spend.js"
import { ArgError, type Control, type Tool, type ToolResult } from "./tools/index.js"
import type { ToolOutput } from "./tools/editor.js"
import { redact } from "./git.js"

/**
 * Minimal agent loop in the spirit of mini-swe-agent: query → execute → append,
 * with limits checked before every call, OpenHands-style stuck detection,
 * batched observation masking (cache-friendly) and format-error feedback.
 */

export type LoopEvent =
  | { type: "llm_call"; model: string; provider: string; purpose: string; costUsd: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; durationMs: number }
  | { type: "agent_thought"; text: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; success: boolean; output: string; durationMs: number }
  | { type: "notice"; level: "info" | "warn"; message: string }

export type LoopLimits = { maxSteps: number; maxWallMs: number; maxFormatErrors: number; maxOutputTokens: number; taskCapUsd?: number }

export type LoopHooks = {
  emit: (e: LoopEvent) => void
  isCancelled?: () => Promise<boolean>
  pollUserMessages?: () => Promise<string[]>
  /** Called on `finish`; return a string to reject the finish and send feedback to the agent. */
  onFinish?: (summary: string) => Promise<string | null>
  onMutation?: (files: string[]) => void
}

export type LoopOutcome =
  | { status: "finished"; summary: string }
  | { status: "plan"; control: Extract<Control, { control: "submit_plan" }> }
  | { status: "ask_user"; question: string }
  | { status: "failed"; reason: string }
  | { status: "cancelled" }

export class AgentLoop {
  messages: Msg[]
  steps = 0
  costUsd = 0
  private formatErrors = 0
  private history: { action: string; obs: string; err: boolean }[] = []
  private stuckWarnings = 0
  /** Views/searches of the same target since the last edit — exploration churn that the exact-repeat detector misses. */
  private explore = new Map<string, number>()
  private started = Date.now()
  private toolsByName: Map<string, Tool>

  constructor(
    private taskId: string,
    private purpose: string,
    private spec: ModelSpec,
    system: string,
    firstUser: string,
    private tools: Tool[],
    private limits: LoopLimits,
    private hooks: LoopHooks,
    resumeMessages?: Msg[],
  ) {
    this.toolsByName = new Map(tools.map((t) => [t.def.function.name, t]))
    this.messages = resumeMessages ?? [
      { role: "system", content: system },
      { role: "user", content: firstUser },
    ]
  }

  addUserMessage(text: string) {
    this.messages.push({ role: "user", content: text })
  }

  async run(): Promise<LoopOutcome> {
    this.started = Date.now()
    while (true) {
      if (this.hooks.isCancelled && (await this.hooks.isCancelled())) return { status: "cancelled" }
      if (this.steps >= this.limits.maxSteps) return { status: "failed", reason: `Step limit reached (${this.limits.maxSteps} model calls)` }
      if (Date.now() - this.started > this.limits.maxWallMs) return { status: "failed", reason: `Time limit reached (${Math.round(this.limits.maxWallMs / 60000)} min)` }

      const incoming = (await this.hooks.pollUserMessages?.()) ?? []
      for (const m of incoming) this.addUserMessage(`Message from the user (takes priority over the plan where they conflict):\n${m}`)

      if (this.steps === this.limits.maxSteps - 3) {
        this.addUserMessage("You are close to the step limit. Wrap up: make sure the change is complete and call finish (or submit_plan in planning mode).")
      }

      this.maskOldObservations()
      let res: LLMResult
      try {
        res = await chat(this.spec, {
          taskId: this.taskId,
          purpose: this.purpose,
          messages: this.messages,
          tools: this.tools.map((t) => t.def),
          maxOutputTokens: this.limits.maxOutputTokens,
          toolChoice: "required",
          ...(this.limits.taskCapUsd !== undefined ? { taskCapUsd: this.limits.taskCapUsd } : {}),
          onUsage: (u) =>
            this.hooks.emit({
              type: "llm_call",
              model: u.model,
              provider: u.provider,
              purpose: u.purpose,
              costUsd: u.costUsd,
              inputTokens: u.inputTokens,
              cachedInputTokens: u.cachedInputTokens,
              outputTokens: u.outputTokens,
              durationMs: u.durationMs,
            }),
        })
      } catch (err) {
        if (err instanceof SpendLimitError) return { status: "failed", reason: `Budget cap reached: ${err.message}` }
        return { status: "failed", reason: `LLM error: ${redact((err as Error).message)}` }
      }
      this.steps++
      this.costUsd += res.costUsd
      if (res.text.trim()) this.hooks.emit({ type: "agent_thought", text: res.text.trim().slice(0, 4000) })

      if (res.toolCalls.length === 0) {
        this.messages.push({ role: "assistant", content: res.text || "" })
        this.formatErrors++
        if (this.formatErrors > this.limits.maxFormatErrors) return { status: "failed", reason: "Model repeatedly failed to call a tool" }
        this.addUserMessage(
          res.finishReason === "length"
            ? "Your response was cut off (too long). Respond with a single, concise tool call."
            : "You must respond with exactly one tool call. Use finish when you are done.",
        )
        continue
      }

      this.messages.push({
        role: "assistant",
        content: res.text || null,
        // Keep provider sidecars (Gemini thought signatures) and which model wrote each call: the
        // renderer needs them to send a valid history to whichever model handles the next turn.
        tool_calls: res.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.rawArgs },
          ...(tc.extra !== undefined ? { extra_content: tc.extra } : {}),
          ...(tc.origin ? { _origin: tc.origin } : {}),
        })) as ChatCompletionMessageToolCall[],
      })

      for (let i = 0; i < res.toolCalls.length; i++) {
        const tc = res.toolCalls[i]!
        const outcome = await this.execTool(tc.id, tc.name, tc.rawArgs)
        if (outcome) {
          // Every tool call in a turn needs a response, or a resumed conversation is rejected by the API.
          for (const rest of res.toolCalls.slice(i + 1)) {
            this.messages.push({ role: "tool", tool_call_id: rest.id, content: "Not executed (the run paused or finished first)." })
          }
          return outcome
        }
      }

      const stuck = this.detectStuck()
      if (stuck) {
        this.stuckWarnings++
        if (this.stuckWarnings >= 2) return { status: "failed", reason: `Agent got stuck: ${stuck}` }
        this.hooks.emit({ type: "notice", level: "warn", message: `Loop detected: ${stuck}` })
        this.addUserMessage(`You appear to be stuck (${stuck}). Step back, re-read the relevant code, and try a different approach.`)
      }
    }
  }

  private async execTool(id: string, name: string, rawArgs: string): Promise<LoopOutcome | null> {
    const tool = this.toolsByName.get(name)
    let args: Record<string, unknown> = {}
    const reply = (content: string) => this.messages.push({ role: "tool", tool_call_id: id, content })

    if (!tool) {
      this.formatErrors++
      reply(`Unknown tool "${name}". Available tools: ${[...this.toolsByName.keys()].join(", ")}.`)
      this.record(`${name}:${rawArgs}`, "unknown tool", true)
      return this.formatErrors > this.limits.maxFormatErrors ? { status: "failed", reason: "Model kept calling unknown tools" } : null
    }
    try {
      args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
    } catch {
      this.formatErrors++
      reply(`Invalid JSON arguments for ${name}. Send valid JSON matching the tool schema${rawArgs.length > 3000 ? " (your arguments were very long — split the change into smaller edits)" : ""}.`)
      return this.formatErrors > this.limits.maxFormatErrors ? { status: "failed", reason: "Model kept sending invalid tool arguments" } : null
    }

    this.hooks.emit({ type: "tool_call", tool: name, args: summarizeArgs(args) })
    const t0 = Date.now()
    let result: ToolResult
    try {
      result = await tool.handler(args)
    } catch (err) {
      const msg = err instanceof ArgError ? err.message : `Tool ${name} failed: ${(err as Error).message}`
      result = { ok: false, output: redact(msg) }
      if (err instanceof ArgError) this.formatErrors++
    }

    if ("control" in result) {
      if (result.control === "finish") {
        const feedback = await this.hooks.onFinish?.(result.summary)
        if (feedback) {
          reply(feedback)
          this.hooks.emit({ type: "tool_result", tool: name, success: false, output: feedback.slice(0, 2000), durationMs: Date.now() - t0 })
          this.record(`finish`, feedback.slice(0, 200), true)
          return null
        }
        reply("Accepted.")
        this.hooks.emit({ type: "tool_result", tool: name, success: true, output: result.summary.slice(0, 2000), durationMs: Date.now() - t0 })
        return { status: "finished", summary: result.summary }
      }
      if (result.control === "submit_plan") {
        reply("Plan submitted.")
        this.hooks.emit({ type: "tool_result", tool: name, success: true, output: result.plan.summary, durationMs: Date.now() - t0 })
        return { status: "plan", control: result }
      }
      reply("Question sent to the user. Wait for the answer.")
      this.hooks.emit({ type: "tool_result", tool: name, success: true, output: result.question, durationMs: Date.now() - t0 })
      return { status: "ask_user", question: result.question }
    }

    const out = result as ToolOutput
    if (out.ok) this.formatErrors = 0
    let safe = redact(out.output)
    if (out.changedFiles?.length) this.explore.clear()
    else if (out.ok && (name === "view" || name === "search") && typeof (name === "view" ? args.path : args.pattern) === "string") {
      const key = `${name}:${String(name === "view" ? args.path : args.pattern)}`
      const n = (this.explore.get(key) ?? 0) + 1
      this.explore.set(key, n)
      if (n === 4 || n === 7) {
        safe +=
          `\n\n[platform note] This is ${name === "view" ? `view #${n} of ${String(args.path)}` : `search #${n} for "${String(args.pattern)}"`} since your last edit. ` +
          `You already have this context — make the edit now (targeted apply_patch/str_replace), or move on to the next plan step.`
      }
    }
    reply(safe)
    this.hooks.emit({ type: "tool_result", tool: name, success: out.ok, output: safe.length > 1800 ? safe.slice(0, 1200) + "\n…\n" + safe.slice(-500) : safe, durationMs: Date.now() - t0 })
    if (out.changedFiles?.length) this.hooks.onMutation?.(out.changedFiles)
    this.record(`${name}:${stableJson(args)}`, safe, !out.ok)
    return null
  }

  private record(action: string, obs: string, err: boolean) {
    this.history.push({ action: hash(action), obs: hash(obs), err })
    if (this.history.length > 20) this.history.shift()
  }

  /** OpenHands stuck scenarios, thresholds tuned down for short runs. */
  private detectStuck(): string | null {
    const h = this.history
    const n = h.length
    if (n >= 3) {
      const last = h.slice(-3)
      if (last.every((x) => x.action === last[0]!.action && x.obs === last[0]!.obs)) return "repeating the same action with the same result"
      if (last.every((x) => x.action === last[0]!.action && x.err)) return "repeating the same failing action"
    }
    if (n >= 6) {
      const l = h.slice(-6)
      if (l[0]!.action === l[2]!.action && l[2]!.action === l[4]!.action && l[1]!.action === l[3]!.action && l[3]!.action === l[5]!.action && l[0]!.action !== l[1]!.action) {
        return "alternating between the same two actions"
      }
    }
    return null
  }

  /**
   * Observation masking by size, with hysteresis: once unmasked tool output passes ~60k chars,
   * mask the oldest until ~30k remain. Counting by size (not by message) matters with parallel
   * tool calls — a count-based rule hid reads from the previous turn and caused re-search churn.
   * The prefix only changes occasionally, so prompt caching keeps working.
   */
  private maskOldObservations() {
    const live = this.messages
      .map((m, i) => (m.role === "tool" && typeof m.content === "string" && !m.content.startsWith("[masked]") && m.content.length > 300 ? i : -1))
      .filter((i) => i >= 0)
    const size = (i: number) => (this.messages[i] as { content: string }).content.length
    let total = live.reduce((a, i) => a + size(i), 0)
    if (total <= 60_000) return
    for (const i of live) {
      if (total <= 30_000) break
      const m = this.messages[i] as { role: "tool"; content: string; tool_call_id: string }
      total -= m.content.length
      m.content = `[masked] Earlier tool output (${m.content.length} chars) removed to save context. Re-run the tool if you need it again.\n${m.content.slice(0, 200)}…`
    }
  }
}

function hash(s: string) {
  return createHash("sha1").update(s).digest("hex").slice(0, 12)
}
function stableJson(o: Record<string, unknown>) {
  return JSON.stringify(Object.keys(o).sort().reduce<Record<string, unknown>>((a, k) => ((a[k] = o[k]), a), {}))
}
function summarizeArgs(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a)) out[k] = typeof v === "string" && v.length > 2500 ? v.slice(0, 2500) + `… (${v.length} chars)` : v
  return out
}
