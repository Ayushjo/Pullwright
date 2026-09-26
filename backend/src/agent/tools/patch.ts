/**
 * `apply_patch` — content-anchored multi-file patch format.
 *
 * Format and matching semantics follow OpenAI Codex's apply-patch crate
 * (codex-rs/apply-patch, Apache-2.0): no line numbers, chunks located by content,
 * optional `@@ <context line>` anchors, and a four-pass sequence seek
 * (exact → ignore trailing ws → trim → normalise unicode punctuation).
 * Error messages mirror Codex's so models trained on it self-correct.
 */

export type Chunk = { context?: string; oldLines: string[]; newLines: string[]; eof: boolean }
export type Hunk =
  | { kind: "add"; path: string; contents: string }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; chunks: Chunk[] }

export class PatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PatchError"
  }
}

const BEGIN = "*** Begin Patch"
const END = "*** End Patch"
const ADD = "*** Add File: "
const DEL = "*** Delete File: "
const UPD = "*** Update File: "
const MOVE = "*** Move to: "
const EOF_MARK = "*** End of File"

function stripWrappers(text: string): string[] {
  let lines = text.replace(/\r\n/g, "\n").split("\n")
  // tolerate heredoc / markdown fences around the patch
  while (lines.length && lines[0]!.trim() !== BEGIN && /^(```|<<|apply_patch|cat\s)/.test(lines[0]!.trim())) lines.shift()
  while (lines.length && lines[lines.length - 1]!.trim() !== END) {
    const last = lines[lines.length - 1]!.trim()
    if (last === "" || last === "```" || last === "EOF" || last === "'EOF'") lines.pop()
    else break
  }
  return lines
}

export function parsePatch(text: string): Hunk[] {
  const lines = stripWrappers(text)
  if (lines[0]?.trim() !== BEGIN) throw new PatchError("The first line of the patch must be '*** Begin Patch'")
  if (lines[lines.length - 1]?.trim() !== END) throw new PatchError("The last line of the patch must be '*** End Patch'")
  const body = lines.slice(1, -1)
  const hunks: Hunk[] = []
  let i = 0
  while (i < body.length) {
    const line = body[i]!
    if (line.trim() === "") {
      i++
      continue
    }
    if (line.startsWith(ADD)) {
      const path = line.slice(ADD.length).trim()
      i++
      const out: string[] = []
      while (i < body.length && !body[i]!.startsWith("*** ")) {
        const l = body[i]!
        if (!l.startsWith("+")) throw new PatchError(`Invalid Add File line for '${path}': every line must start with '+', got: '${l}'`)
        out.push(l.slice(1))
        i++
      }
      hunks.push({ kind: "add", path, contents: out.join("\n") + "\n" })
      continue
    }
    if (line.startsWith(DEL)) {
      hunks.push({ kind: "delete", path: line.slice(DEL.length).trim() })
      i++
      continue
    }
    if (line.startsWith(UPD)) {
      const path = line.slice(UPD.length).trim()
      i++
      let moveTo: string | undefined
      if (body[i]?.startsWith(MOVE)) {
        moveTo = body[i]!.slice(MOVE.length).trim()
        i++
      }
      const chunks: Chunk[] = []
      let cur: Chunk | null = null
      while (i < body.length && !(body[i]!.startsWith("*** ") && body[i] !== EOF_MARK)) {
        const l = body[i]!
        if (l === EOF_MARK) {
          if (cur) cur.eof = true
          i++
          continue
        }
        if (l.startsWith("@@")) {
          if (cur && (cur.oldLines.length || cur.newLines.length)) chunks.push(cur)
          const ctx = l.slice(2).trim()
          cur = { oldLines: [], newLines: [], eof: false, ...(ctx ? { context: ctx } : {}) }
          i++
          continue
        }
        if (!cur) {
          if (chunks.length > 0) throw new PatchError(`Expected update hunk to start with a @@ context marker, got: '${l}'`)
          cur = { oldLines: [], newLines: [], eof: false }
        }
        const tag = l[0]
        const rest = l.slice(1)
        if (l === "") {
          // a bare empty line inside a chunk is an unchanged blank line
          cur.oldLines.push("")
          cur.newLines.push("")
        } else if (tag === " ") {
          cur.oldLines.push(rest)
          cur.newLines.push(rest)
        } else if (tag === "-") {
          cur.oldLines.push(rest)
        } else if (tag === "+") {
          cur.newLines.push(rest)
        } else {
          throw new PatchError(
            `Unexpected line found in update hunk: '${l}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
          )
        }
        i++
      }
      if (cur && (cur.oldLines.length || cur.newLines.length)) chunks.push(cur)
      if (chunks.length === 0) throw new PatchError(`Update file hunk for path '${path}' is empty`)
      hunks.push({ kind: "update", path, ...(moveTo ? { moveTo } : {}), chunks })
      continue
    }
    throw new PatchError(
      `'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
    )
  }
  if (hunks.length === 0) throw new PatchError("Patch contains no hunks")
  return hunks
}

const PUNCT: Record<string, string> = {
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
}
const normalise = (s: string) => s.trim().replace(/./gu, (c) => PUNCT[c] ?? c)

/** Codex `seek_sequence`: find `pattern` in `lines` at or after `start`. */
export function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): number {
  if (pattern.length === 0) return start
  if (pattern.length > lines.length) return -1
  const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start
  const passes: ((s: string) => string)[] = [(s) => s, (s) => s.trimEnd(), (s) => s.trim(), normalise]
  for (const f of passes) {
    for (let i = searchStart; i <= lines.length - pattern.length; i++) {
      let ok = true
      for (let j = 0; j < pattern.length; j++) {
        if (f(lines[i + j]!) !== f(pattern[j]!)) {
          ok = false
          break
        }
      }
      if (ok) return i
    }
  }
  if (eof && searchStart !== start) return seekSequence(lines, pattern, start, false)
  return -1
}

/** Apply update chunks to file content. Returns new content. */
export function applyChunks(path: string, content: string, chunks: Chunk[]): string {
  const hadTrailingNewline = content.endsWith("\n")
  const lines = content.split("\n")
  if (hadTrailingNewline) lines.pop()
  const replacements: { at: number; len: number; lines: string[] }[] = []
  let cursor = 0
  for (const ch of chunks) {
    if (ch.context) {
      const idx = seekSequence(lines, [ch.context], cursor, false)
      if (idx < 0) throw new PatchError(`Failed to find context '${ch.context}' in ${path}`)
      cursor = idx + 1
    }
    if (ch.oldLines.length === 0) {
      // pure insertion: at end of file (or right after the context line)
      const at = ch.context ? cursor : lines.length
      replacements.push({ at, len: 0, lines: ch.newLines })
      continue
    }
    let oldL = ch.oldLines
    let newL = ch.newLines
    let idx = seekSequence(lines, oldL, cursor, ch.eof)
    if (idx < 0 && oldL[oldL.length - 1] === "") {
      oldL = oldL.slice(0, -1)
      if (newL[newL.length - 1] === "") newL = newL.slice(0, -1)
      idx = seekSequence(lines, oldL, cursor, ch.eof)
    }
    if (idx < 0) throw new PatchError(`Failed to find expected lines in ${path}:\n${ch.oldLines.join("\n")}`)
    replacements.push({ at: idx, len: oldL.length, lines: newL })
    cursor = idx + oldL.length
  }
  replacements.sort((a, b) => b.at - a.at)
  for (const r of replacements) lines.splice(r.at, r.len, ...r.lines)
  return lines.join("\n") + (hadTrailingNewline || lines.length > 0 ? "\n" : "")
}
