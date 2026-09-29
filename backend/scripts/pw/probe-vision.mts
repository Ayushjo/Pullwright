/**
 * Which lanes can read an image from an issue, and what the image costs in prompt tokens:
 *
 *   npx tsx --env-file=.env scripts/pw/probe-vision.mts vercel:openai/gpt-5-mini gemini:gemini-3.5-flash-lite groq:qwen/qwen3.8-27b
 *
 * For each lane and each image size, sends the same question twice (text only, then with the image as an
 * OpenAI-style image_url data URL) and records: accepted or error class, whether the answer reads the
 * screenshot ($NaN total), and the extra prompt tokens the image cost (usage delta). Appends rows to
 * .spend/vision-probes.jsonl. About 2 small requests per lane per size.
 */
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PROVIDERS, type ProviderId } from "../../src/llm/registry.js"

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const images = [
  { name: "800px", file: path.join(backend, "evals/fixtures/images/cart-nan.png") },
  ...(process.env.PROBE_LARGE ? [{ name: process.env.PROBE_LARGE_NAME ?? "large", file: process.env.PROBE_LARGE }] : []),
]
const question = "A user attached this screenshot to a bug report about the cart page. What total does it show, and what looks wrong? Answer in one sentence."

const lanes = process.argv.slice(2).map((s) => {
  const i = s.indexOf(":")
  return { provider: s.slice(0, i) as ProviderId, model: s.slice(i + 1) }
})
if (!lanes.length) {
  console.log("usage: probe-vision.mts provider:model [...]")
  process.exit(1)
}

async function send(provider: ProviderId, model: string, content: unknown) {
  const desc = PROVIDERS[provider]
  const key = desc.platformKeyEnv ? process.env[desc.platformKeyEnv] : undefined
  if (!desc.baseURL || !key) throw new Error(`no platform key for ${provider}`)
  const t0 = Date.now()
  const res = await fetch(`${desc.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], [desc.params.maxTokensField]: 1500 }),
    signal: AbortSignal.timeout(90_000),
  })
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; cost?: number }
    error?: { message?: string } | string
  }
  if (!res.ok) {
    const msg = typeof body.error === "string" ? body.error : (body.error?.message ?? JSON.stringify(body).slice(0, 200))
    throw new Error(`${res.status} ${msg.slice(0, 160)}`)
  }
  return { text: body.choices?.[0]?.message?.content ?? "", promptTokens: body.usage?.prompt_tokens ?? 0, cost: body.usage?.cost, ms: Date.now() - t0 }
}

const rows: Record<string, unknown>[] = []
for (const lane of lanes) {
  let base: Awaited<ReturnType<typeof send>> | null = null
  try {
    base = await send(lane.provider, lane.model, question)
  } catch (e) {
    rows.push({ lane: `${lane.provider}:${lane.model}`, image: "-", result: `✗ text-only: ${(e as Error).message}` })
    continue
  }
  for (const img of images) {
    const url = `data:image/png;base64,${readFileSync(img.file).toString("base64")}`
    const row: Record<string, unknown> = { lane: `${lane.provider}:${lane.model}`, image: img.name }
    try {
      const r = await send(lane.provider, lane.model, [
        { type: "text", text: question },
        { type: "image_url", image_url: { url } },
      ])
      row.result = /nan/i.test(r.text) ? "✓ reads it" : "? answer ignores the image"
      row.imageTokens = r.promptTokens - base.promptTokens
      row.ms = r.ms
      if (r.cost !== undefined) row.costUsd = r.cost
      row.answer = r.text.replace(/\s+/g, " ").slice(0, 140)
    } catch (e) {
      row.result = `✗ ${(e as Error).message}`
    }
    rows.push(row)
    appendFileSync(path.join(backend, ".spend/vision-probes.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n")
  }
}
for (const r of rows) console.log(JSON.stringify(r))
process.exit(0)
