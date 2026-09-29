import type { ChatFn } from "../../llm/lanes.js"
import { redact } from "../git.js"
import { dataUrl, type Attachment } from "./attachments.js"

/**
 * Transcribe each issue image once into text (docs/architecture/intake.md §13.4). Executor lanes may be
 * text-only (gpt-oss rejects images), and resending an image on every one of 30–60 calls wastes free
 * quota; SWE-bench Multimodal found text-heavy images lose nothing as text, so the facts travel as a
 * transcript and only the planner/reviewer get pixels.
 */

export type Vision = {
  kind: "screenshot" | "code" | "error" | "diagram" | "mockup" | "chart" | "photo" | "other"
  visibleText: string
  elements: string
  whatLooksWrong: string
  relationToIssue: string
  confidence: "low" | "medium" | "high"
}

export const DESCRIBE_SYSTEM = `You transcribe an image attached to a GitHub issue for a coding agent that cannot see it.
Reply with a JSON object only:
{"kind": "screenshot"|"code"|"error"|"diagram"|"mockup"|"chart"|"photo"|"other",
 "visibleText": "the text that matters, verbatim (labels, values, error messages, code); keep exact spelling, numbers and punctuation",
 "elements": "what is shown and where, briefly (layout, highlighted parts)",
 "whatLooksWrong": "what the reporter most likely points at, or empty if nothing looks wrong",
 "relationToIssue": "how the image relates to the issue text",
 "confidence": "low"|"medium"|"high"}
Describe only what is visible. Never guess values you cannot read; write [unreadable] instead.`

const KINDS = new Set(["screenshot", "code", "error", "diagram", "mockup", "chart", "photo", "other"])

export function parseVision(text: string): Vision | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const str = (k: string) => (typeof j[k] === "string" ? (j[k] as string).trim() : "")
    const kind = str("kind")
    const conf = str("confidence")
    return {
      kind: (KINDS.has(kind) ? kind : "other") as Vision["kind"],
      visibleText: str("visibleText").slice(0, 3000),
      elements: str("elements").slice(0, 800),
      whatLooksWrong: str("whatLooksWrong").slice(0, 600),
      relationToIssue: str("relationToIssue").slice(0, 600),
      confidence: (["low", "medium", "high"].includes(conf) ? conf : "low") as Vision["confidence"],
    }
  } catch {
    return null
  }
}

/** The text the planner and executor see in place of the image. */
export function visionText(v: Vision): string {
  return [
    `kind: ${v.kind} (confidence ${v.confidence})`,
    v.visibleText && `visible text: ${v.visibleText}`,
    v.elements && `shows: ${v.elements}`,
    v.whatLooksWrong && `looks wrong: ${v.whatLooksWrong}`,
    v.relationToIssue && `relation to the issue: ${v.relationToIssue}`,
  ]
    .filter(Boolean)
    .join("\n")
}

export type Described = Attachment & { vision?: Vision }

/**
 * One call per image on the given (vision-capable) lanes. Failures leave the image without a
 * transcript and say why — the task continues text-only.
 */
export async function describeImages(atts: Attachment[], issue: { title: string; body: string }, chat: ChatFn, taskId: string): Promise<Described[]> {
  const out: Described[] = []
  for (const a of atts) {
    if (a.kind !== "image" || !a.file) {
      out.push(a)
      continue
    }
    const url = await dataUrl(a)
    if (!url) {
      out.push(a)
      continue
    }
    const where = [a.alt && `alt text "${a.alt}"`, a.context && `next to: "${a.context}"`].filter(Boolean).join("; ")
    try {
      const res = await chat({
        taskId,
        purpose: "describe",
        messages: [
          { role: "system", content: DESCRIBE_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `Issue: ${issue.title}\n${issue.body.slice(0, 1500)}\n\nImage ${a.n} (${a.where}${where ? `; ${where}` : ""}):` },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
        maxOutputTokens: 1_500,
        jsonMode: true,
      })
      const v = parseVision(res.text)
      if (v) {
        v.visibleText = redact(v.visibleText) // screenshots can show keys and tokens
        out.push({ ...a, vision: v, description: visionText(v) })
      } else {
        out.push({ ...a, description: redact(res.text.slice(0, 1500)) })
      }
    } catch (e) {
      out.push({ ...a, skipped: `could not be read: ${(e as Error).message.slice(0, 100)}` })
    }
  }
  return out
}

/** "Attachments" block for the plan message (text only; the planner may also get the pixels). */
export function attachmentsBlock(atts: Described[]): string {
  if (!atts.length) return ""
  const lines = atts.map((a) => {
    const head = `[attachment ${a.n} · ${a.kind} · ${a.where}${a.alt ? ` · "${a.alt}"` : ""}]`
    if (a.skipped) return `${head} not available: ${a.skipped}`
    if (a.kind === "file") return `${head}\n${a.description ?? ""}`
    return `${head}${a.context ? ` (next to: "${a.context}")` : ""}\n${a.description ?? "(no transcript)"}`
  })
  return `## Attachments (images transcribed to text by a vision model; may contain reading errors)\n${lines.join("\n\n")}`
}
