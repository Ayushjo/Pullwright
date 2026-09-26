import { PathError, type Workspace } from "../workspace.js"
import { newSyntaxErrors, type SyntaxIssue } from "./syntax.js"
import { applyChunks, parsePatch, PatchError, seekSequence } from "./patch.js"
import { outline } from "../repoMap.js"

export type ToolOutput = { ok: boolean; output: string; changedFiles?: string[] }

const MAX_VIEW_LINES = 250
const MAX_OUTPUT_CHARS = 16_000
const SNIPPET_CONTEXT = 4

function numbered(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length).length
  return lines.map((l, i) => `${String(startLine + i).padStart(width)}\t${l}`).join("\n")
}

function clip(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s
  return (
    s.slice(0, MAX_OUTPUT_CHARS) +
    `\n<response clipped: output exceeded ${MAX_OUTPUT_CHARS} chars. Use view with a line range, or search to locate the exact lines.>`
  )
}

function snippetAround(content: string, startLine: number, newLineCount: number): string {
  const lines = content.split("\n")
  const from = Math.max(0, startLine - SNIPPET_CONTEXT)
  const to = Math.min(lines.length, startLine + newLineCount + SNIPPET_CONTEXT)
  return numbered(lines.slice(from, to), from + 1)
}

function lintFailure(path: string, errs: SyntaxIssue[], after: string): ToolOutput {
  const first = errs[0]?.line ?? 1
  const lines = after.split("\n")
  const from = Math.max(0, first - 6)
  const preview = numbered(lines.slice(from, Math.min(lines.length, first + 5)), from + 1)
  return {
    ok: false,
    output:
      `Your edit to ${path} was REVERTED because it introduced syntax errors:\n` +
      errs.slice(0, 5).map((e) => `  line ${e.line}: ${e.message}`).join("\n") +
      `\n\nThis is how the file would have looked around line ${first}:\n${preview}\n\n` +
      `The file is unchanged. Fix the edit (check brackets, quotes, JSX tags) and try again. Do not repeat the same edit.`,
  }
}

export class Editor {
  constructor(private ws: Workspace) {}

  private async missing(p: string): Promise<ToolOutput> {
    const sugg = await this.ws.suggest(p)
    return {
      ok: false,
      output:
        `The path ${p} does not exist.` +
        (sugg.length ? ` Did you mean one of:\n${sugg.map((s) => "  " + s).join("\n")}` : " Use list_dir or search to find the right file."),
    }
  }

  async view(p: string, startLine?: number, endLine?: number): Promise<ToolOutput> {
    try {
      const rel = this.ws.rel(p)
      if (!this.ws.exists(rel)) return this.missing(p)
      if (this.ws.isDir(rel)) return { ok: false, output: `${rel || "."} is a directory. Use list_dir.` }
      const content = await this.ws.read(rel)
      const lines = content.split("\n")
      if (content.endsWith("\n")) lines.pop()
      const total = lines.length
      if (startLine === undefined && total > MAX_VIEW_LINES) {
        const map = outline(rel, content)
        return {
          ok: true,
          output: clip(
            `[File: ${rel} (${total} lines total) — too long to show at once]\n` +
              (map ? `Outline (line: declaration):\n${map}\n\n` : "") +
              `First ${MAX_VIEW_LINES / 2} lines:\n${numbered(lines.slice(0, MAX_VIEW_LINES / 2), 1)}\n` +
              `(${total - MAX_VIEW_LINES / 2} more lines below — call view with start_line/end_line)`,
          ),
        }
      }
      const s = Math.max(1, startLine ?? 1)
      const e = Math.min(total, endLine ?? Math.min(total, s + MAX_VIEW_LINES - 1), s + MAX_VIEW_LINES - 1)
      if (s > total) return { ok: false, output: `start_line ${s} is past the end of ${rel} (${total} lines).` }
      const header = `[File: ${rel} (${total} lines total)]` + (s > 1 ? `\n(${s - 1} more lines above)` : "")
      const footer = e < total ? `\n(${total - e} more lines below)` : ""
      return { ok: true, output: clip(`${header}\n${numbered(lines.slice(s - 1, e), s)}${footer}`) }
    } catch (err) {
      return { ok: false, output: err instanceof PathError ? err.message : `view failed: ${(err as Error).message}` }
    }
  }

  async createFile(p: string, content: string): Promise<ToolOutput> {
    try {
      const rel = this.ws.rel(p)
      if (!rel) return { ok: false, output: "A file path is required." }
      if (this.ws.exists(rel)) {
        return { ok: false, output: `File ${rel} already exists. Use str_replace or apply_patch to modify it — never rewrite whole files.` }
      }
      const body = content.endsWith("\n") ? content : content + "\n"
      const errs = newSyntaxErrors(rel, null, body)
      if (errs.length) return lintFailure(rel, errs, body)
      await this.ws.write(rel, body)
      return { ok: true, output: `Created ${rel} (${body.split("\n").length - 1} lines).`, changedFiles: [rel] }
    } catch (err) {
      return { ok: false, output: err instanceof PathError ? err.message : `create_file failed: ${(err as Error).message}` }
    }
  }

  async strReplace(p: string, oldStr: string, newStr: string): Promise<ToolOutput> {
    try {
      const rel = this.ws.rel(p)
      if (!this.ws.exists(rel) || this.ws.isDir(rel)) return this.missing(p)
      if (oldStr === newStr) return { ok: false, output: "old_str and new_str are identical — no change made." }
      if (!oldStr) return { ok: false, output: "old_str must not be empty. To add a new file use create_file." }
      const before = await this.ws.read(rel)

      let after: string | null = null
      let startLine = 0
      const exactCount = before.split(oldStr).length - 1
      if (exactCount > 1) {
        const lines: number[] = []
        let idx = before.indexOf(oldStr)
        while (idx >= 0) {
          lines.push(before.slice(0, idx).split("\n").length)
          idx = before.indexOf(oldStr, idx + 1)
        }
        return {
          ok: false,
          output: `No replacement was performed. Multiple occurrences of old_str in ${rel} at lines ${lines.join(", ")}. Include more surrounding lines so it is unique.`,
        }
      }
      if (exactCount === 1) {
        const idx = before.indexOf(oldStr)
        startLine = before.slice(0, idx).split("\n").length - 1
        after = before.slice(0, idx) + newStr + before.slice(idx + oldStr.length)
      } else {
        // Whitespace/punctuation-tolerant line match (Codex seek passes), must be unique.
        const fileLines = before.split("\n")
        const pat = oldStr.replace(/\n$/, "").split("\n")
        const at = seekSequence(fileLines, pat, 0, false)
        const again = at >= 0 ? seekSequence(fileLines, pat, at + 1, false) : -1
        if (at >= 0 && again < 0) {
          const newLines = newStr.replace(/\n$/, "").split("\n")
          fileLines.splice(at, pat.length, ...newLines)
          after = fileLines.join("\n")
          startLine = at
        } else {
          const hint = closestLines(before, oldStr)
          return {
            ok: false,
            output:
              `No replacement was performed, old_str did not appear verbatim in ${rel}.` +
              (hint ? `\nThe most similar lines in the file are:\n${hint}\nCopy the exact text (use view first).` : " Use view to copy the exact text."),
          }
        }
      }

      const errs = newSyntaxErrors(rel, before, after)
      if (errs.length) return lintFailure(rel, errs, after)
      await this.ws.write(rel, after)
      const newCount = newStr.split("\n").length
      return {
        ok: true,
        output: `Edited ${rel}. Snippet of the result:\n${snippetAround(after, startLine, newCount)}`,
        changedFiles: [rel],
      }
    } catch (err) {
      return { ok: false, output: err instanceof PathError ? err.message : `str_replace failed: ${(err as Error).message}` }
    }
  }

  async applyPatch(patchText: string): Promise<ToolOutput> {
    let hunks
    try {
      hunks = parsePatch(patchText)
    } catch (err) {
      return { ok: false, output: `apply_patch verification failed: ${(err as Error).message}` }
    }
    // Stage everything in memory first — all-or-nothing.
    const staged = new Map<string, string | null>() // rel → content (null = delete)
    const originals = new Map<string, string | null>()
    try {
      for (const h of hunks) {
        const rel = this.ws.rel(h.path)
        if (h.kind === "add") {
          if (this.ws.exists(rel)) throw new PatchError(`Add File Error: ${rel} already exists — use '*** Update File' instead`)
          staged.set(rel, h.contents)
          originals.set(rel, null)
        } else if (h.kind === "delete") {
          if (!this.ws.exists(rel)) throw new PatchError(`Delete File Error: ${rel} does not exist`)
          originals.set(rel, await this.ws.read(rel))
          staged.set(rel, null)
        } else {
          if (!this.ws.exists(rel)) {
            const sugg = await this.ws.suggest(rel)
            throw new PatchError(`Update File Error: Missing File: ${rel}` + (sugg.length ? ` (did you mean ${sugg.slice(0, 3).join(", ")}?)` : ""))
          }
          const current = staged.has(rel) ? (staged.get(rel) ?? "") : await this.ws.read(rel)
          if (!originals.has(rel)) originals.set(rel, current)
          const next = applyChunks(rel, current, h.chunks)
          if (h.moveTo) {
            const dest = this.ws.rel(h.moveTo)
            staged.set(rel, null)
            staged.set(dest, next)
            if (!originals.has(dest)) originals.set(dest, this.ws.exists(dest) ? await this.ws.read(dest) : null)
          } else {
            staged.set(rel, next)
          }
        }
      }
    } catch (err) {
      const msg = err instanceof PatchError || err instanceof PathError ? err.message : (err as Error).message
      return { ok: false, output: `apply_patch verification failed: ${msg}\nNo files were modified.` }
    }

    for (const [rel, content] of staged) {
      if (content === null) continue
      const errs = newSyntaxErrors(rel, originals.get(rel) ?? null, content)
      if (errs.length) {
        const r = lintFailure(rel, errs, content)
        return { ok: false, output: r.output.replace(/^Your edit/, "Your patch") + "\nNo files were modified." }
      }
    }
    const summary: string[] = []
    for (const [rel, content] of staged) {
      if (content === null) {
        await this.ws.remove(rel)
        summary.push(`D ${rel}`)
      } else {
        await this.ws.write(rel, content)
        summary.push(`${originals.get(rel) === null ? "A" : "M"} ${rel}`)
      }
    }
    return { ok: true, output: `Success. Updated the following files:\n${summary.join("\n")}`, changedFiles: [...staged.keys()] }
  }
}

/** Aider-style "did you mean": the window of file lines most similar to `needle`. */
function closestLines(haystack: string, needle: string): string {
  const hl = haystack.split("\n")
  const nl = needle.replace(/\n$/, "").split("\n")
  const firstNeedle = nl.find((l) => l.trim().length > 3)?.trim()
  if (!firstNeedle) return ""
  let best = -1
  let bestScore = 0
  for (let i = 0; i < hl.length; i++) {
    const s = similarity(hl[i]!.trim(), firstNeedle)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  if (best < 0 || bestScore < 0.5) return ""
  const from = Math.max(0, best - 2)
  return numbered(hl.slice(from, Math.min(hl.length, best + nl.length + 2)), from + 1)
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const bigrams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0)
  return (2 * inter) / Math.max(1, a.length - 1 + (b.length - 1))
}
