import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { safeFetchManual } from "../../llm/safeEndpoint.js"

/**
 * Attachments in an issue (docs/architecture/intake.md §13.4). GitHub serves them from a few content
 * hosts; for private repos the only working route is the API's body_html, whose image URLs carry a JWT
 * that expires after 300 s (measured). So: extract from markdown (position, alt text, context) and pair
 * each with its signed body_html URL, then download right away — only from GitHub content hosts, never
 * with our credentials attached, never following a redirect off the allowlist.
 */

export type AttachmentKind = "image" | "video" | "file" | "unknown"

export type AttachmentRef = {
  n: number
  /** issue | comment 1, comment 2 … */
  where: string
  kind: AttachmentKind
  /** URL as written in the markdown. */
  url: string
  /** URL to download (the signed body_html URL when there is one). */
  fetchUrl: string
  alt: string
  /** The sentence around the attachment, so the transcript can be read in place. */
  context: string
}

export type Attachment = AttachmentRef & {
  file?: string
  mime?: string
  bytes?: number
  sha256?: string
  /** Why it was not downloaded (too big, video, host not allowed…). */
  skipped?: string
  /** Filled by describe.ts (images) or with the file's text (logs). */
  description?: string
}

export const LIMITS = { images: 6, imageBytes: 10 * 1024 * 1024, fileBytes: 200 * 1024, textChars: 8_000 }

const ASSET_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const TAG_IMG = /<img\b[^>]*>/gi
const BARE_ASSET = /(?<![("'<=])\bhttps:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}\b/gi
const MD_FILE = /(?<!!)\[([^\]]+)\]\((https:\/\/github\.com\/user-attachments\/files\/[^)\s]+)\)/g

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? ""
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

function contextAt(md: string, index: number): string {
  const lines = md.split("\n")
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    const end = pos + lines[i]!.length
    if (index <= end) {
      const strip = (l: string) => l.replace(MD_IMAGE, "").replace(TAG_IMG, "").replace(BARE_ASSET, "").trim()
      const here = strip(lines[i]!)
      const prev = [...lines.slice(0, i)].reverse().map(strip).find(Boolean) ?? ""
      return [prev, here].filter(Boolean).join(" ").slice(0, 200)
    }
    pos = end + 1
  }
  return ""
}

/** Signed/rewritten image and video URLs in body_html, in document order. */
function htmlSources(html: string | undefined): string[] {
  if (!html) return []
  const out: string[] = []
  for (const m of html.matchAll(/<(?:img|video|source)\b[^>]*>/gi)) {
    const src = attr(m[0], "src") || attr(m[0], "data-canonical-src")
    if (src) out.push(decode(src))
  }
  return out
}

/**
 * Attachments in one markdown body, paired with body_html's signed URLs: by GitHub asset id when both
 * carry one, otherwise in document order (external images come through camo.githubusercontent.com).
 */
export function extractAttachments(markdown: string, html: string | undefined, where: string, start = 1): AttachmentRef[] {
  const found: { index: number; kind: AttachmentKind; url: string; alt: string }[] = []
  for (const m of markdown.matchAll(MD_IMAGE)) found.push({ index: m.index!, kind: "image", url: m[2]!, alt: m[1]!.trim() })
  for (const m of markdown.matchAll(TAG_IMG)) {
    const src = attr(m[0], "src")
    if (src) found.push({ index: m.index!, kind: "image", url: decode(src), alt: attr(m[0], "alt").trim() })
  }
  // A bare asset link on its own is how GitHub embeds videos (images get ![]()): the type is known only on download.
  for (const m of markdown.matchAll(BARE_ASSET)) found.push({ index: m.index!, kind: "unknown", url: m[0], alt: "" })
  for (const m of markdown.matchAll(MD_FILE)) found.push({ index: m.index!, kind: "file", url: m[2]!, alt: m[1]!.trim() })
  found.sort((a, b) => a.index - b.index)

  const sources = htmlSources(html)
  const used = new Set<number>()
  const byId = (url: string) => {
    const id = url.match(ASSET_ID)?.[0]?.toLowerCase()
    if (!id) return -1
    return sources.findIndex((s, i) => !used.has(i) && s.toLowerCase().includes(id))
  }
  const refs: AttachmentRef[] = []
  for (const f of found) {
    let fetchUrl = f.url
    if (f.kind !== "file") {
      let i = byId(f.url)
      if (i < 0 && !ASSET_ID.test(f.url)) i = sources.findIndex((s, j) => !used.has(j) && !ASSET_ID.test(s))
      if (i >= 0) {
        used.add(i)
        fetchUrl = sources[i]!
      }
    }
    refs.push({ n: start + refs.length, where, kind: f.kind, url: f.url, fetchUrl, alt: f.alt, context: contextAt(markdown, f.index) })
  }
  return refs
}

// ── Download ────────────────────────────────────────────────────────────────

const ALLOWED_HOSTS: (string | RegExp)[] = [
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
  "camo.githubusercontent.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  /^github-production-user-asset-[a-z0-9]+\.s3\.amazonaws\.com$/,
  /^github-production-repository-file-[a-z0-9]+\.s3\.amazonaws\.com$/,
]

export function allowedUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== "https:" || u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  if (host === "github.com") return /^\/user-attachments\/(assets|files)\//.test(u.pathname) ? u : null
  return ALLOWED_HOSTS.some((h) => (typeof h === "string" ? h === host : h.test(host))) ? u : null
}

export function sniff(buf: Buffer): { kind: AttachmentKind; mime: string; ext: string } | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png", ext: "png" }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return { kind: "image", mime: "image/gif", ext: "gif" }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" }
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") return { kind: "video", mime: "video/mp4", ext: "mp4" }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: "video", mime: "video/webm", ext: "webm" }
  return null
}

type Fetch = typeof fetch

/** GET with every redirect hop checked against the allowlist; stops reading past maxBytes. */
export async function fetchAllowed(raw: string, maxBytes: number, fetchImpl: Fetch = safeFetchManual): Promise<{ bytes: Buffer; contentType: string } | { skipped: string }> {
  let current = raw
  for (let hop = 0; hop < 4; hop++) {
    const u = allowedUrl(current)
    if (!u) return { skipped: `host not allowed (${safeHost(current)})` }
    const res = await fetchImpl(u.toString(), { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Pullwright" } })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location")
      if (!loc) return { skipped: `redirect without location (${res.status})` }
      current = new URL(loc, u).toString()
      continue
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) return { skipped: `not accessible (HTTP ${res.status}); for private repos the link may have expired` }
    if (!res.ok) return { skipped: `HTTP ${res.status}` }
    const contentType = res.headers.get("content-type") ?? ""
    if (/^video\//i.test(contentType)) {
      await res.body?.cancel().catch(() => {})
      return { skipped: "video (not analysed)" }
    }
    const declared = Number(res.headers.get("content-length") ?? 0)
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => {})
      return { skipped: `too large (${Math.round(declared / 1024)} KB)` }
    }
    const chunks: Buffer[] = []
    let total = 0
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength
        if (total > maxBytes) return { skipped: `too large (> ${Math.round(maxBytes / 1024)} KB)` }
        chunks.push(Buffer.from(chunk))
      }
    }
    return { bytes: Buffer.concat(chunks), contentType }
  }
  return { skipped: "too many redirects" }
}

const safeHost = (raw: string) => {
  try {
    return new URL(raw).hostname
  } catch {
    return "invalid URL"
  }
}

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
/** Local eval tasks reference fixture images as attachment://name.png (basename only). */
export const evalAttachmentsDir = () => path.resolve(process.env.EVAL_ATTACHMENTS_DIR ?? path.join(backendRoot, "evals/fixtures/images"))

async function readLocal(url: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string } | { skipped: string }> {
  const name = url.slice("attachment://".length)
  if (!/^[\w.-]+$/.test(name)) return { skipped: "invalid local attachment name" }
  try {
    const bytes = await readFile(path.join(evalAttachmentsDir(), name))
    return bytes.length > maxBytes ? { skipped: "too large" } : { bytes, contentType: "" }
  } catch {
    return { skipped: "local attachment not found" }
  }
}

/**
 * Downloads attachments into dir (outside the repo, so they never enter the diff). Images: ≤6, ≤10 MB,
 * deduplicated; text files ≤200 KB are inlined as text; videos and anything else are listed as skipped.
 */
export async function downloadAttachments(refs: AttachmentRef[], dir: string, opts: { local?: boolean; fetchImpl?: Fetch } = {}): Promise<Attachment[]> {
  await mkdir(dir, { recursive: true })
  const out: Attachment[] = []
  const seen = new Set<string>()
  let images = 0
  for (const ref of refs) {
    if (ref.kind === "video") {
      out.push({ ...ref, skipped: "video (not analysed)" })
      continue
    }
    if (ref.kind !== "file" && images >= LIMITS.images) {
      out.push({ ...ref, skipped: `more than ${LIMITS.images} images` })
      continue
    }
    const max = ref.kind === "file" ? LIMITS.fileBytes : LIMITS.imageBytes
    let got: { bytes: Buffer; contentType: string } | { skipped: string }
    try {
      got = opts.local && ref.fetchUrl.startsWith("attachment://") ? await readLocal(ref.fetchUrl, max) : await fetchAllowed(ref.fetchUrl, max, opts.fetchImpl)
    } catch (e) {
      got = { skipped: `download failed: ${(e as Error).message.slice(0, 80)}` }
    }
    if ("skipped" in got) {
      out.push({ ...ref, skipped: got.skipped })
      continue
    }
    const sha256 = createHash("sha256").update(got.bytes).digest("hex")
    if (seen.has(sha256)) {
      out.push({ ...ref, skipped: "duplicate of an earlier attachment" })
      continue
    }
    seen.add(sha256)
    const type = sniff(got.bytes)
    if (type?.kind === "image") {
      images++
      const file = path.join(dir, `${ref.n}-${sha256.slice(0, 12)}.${type.ext}`)
      await writeFile(file, got.bytes)
      out.push({ ...ref, kind: "image", file, mime: type.mime, bytes: got.bytes.length, sha256 })
    } else if (type?.kind === "video") {
      out.push({ ...ref, kind: "video", skipped: "video (not analysed)" })
    } else if (ref.kind === "file" && isText(got.bytes)) {
      const text = got.bytes.toString("utf8")
      out.push({ ...ref, kind: "file", bytes: got.bytes.length, sha256, description: text.length > LIMITS.textChars ? `${text.slice(0, LIMITS.textChars)}\n… (${text.length - LIMITS.textChars} more characters)` : text })
    } else {
      out.push({ ...ref, skipped: "unsupported file type" })
    }
  }
  return out
}

function isText(buf: Buffer): boolean {
  if (buf.includes(0)) return false
  const s = buf.subarray(0, 4096).toString("utf8")
  return !s.includes("�")
}

/** data: URL for a stored image, for model calls (providers never get a GitHub URL). */
export async function dataUrl(a: Attachment): Promise<string | null> {
  if (!a.file || !a.mime) return null
  return `data:${a.mime};base64,${(await readFile(a.file)).toString("base64")}`
}
