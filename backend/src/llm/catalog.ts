import logger from "../logger.js"
import type { Price } from "../agent/spend.js"

/**
 * Live prices per route (provider × model), from the gateways' own model lists:
 *   - OpenRouter: public GET https://openrouter.ai/api/v1/models (no key)
 *   - Vercel AI Gateway: GET https://ai-gateway.vercel.sh/v1/models (with AI_GATEWAY_API_KEY)
 * The same model can cost very different amounts per route (DeepSeek V4.1 Flash: $0.035 in on
 * OpenRouter vs $0.30 on Vercel, 2026-09-29), so prices are keyed by route. Kept in memory, refreshed
 * daily; the static table in spend.ts remains the fallback (and covers direct providers).
 */

const routes = new Map<string, Price>() // "openrouter:deepseek/deepseek-v4.1-flash" → price per 1M tokens
let loadedAt = 0

type RawPricing = { prompt?: string; completion?: string; input_cache_read?: string; input?: string; output?: string }
const perMillion = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v) * 1_000_000)

function add(provider: string, id: string, p: RawPricing) {
  const input = perMillion(p.prompt ?? p.input)
  const output = perMillion(p.completion ?? p.output)
  if (input === undefined || output === undefined || !Number.isFinite(input) || !Number.isFinite(output)) return
  const cached = perMillion(p.input_cache_read)
  routes.set(`${provider}:${id}`, { input, output, cachedInput: cached !== undefined && Number.isFinite(cached) ? cached : input })
}

export async function refreshCatalog(fetchImpl: typeof fetch = fetch): Promise<number> {
  const before = routes.size
  try {
    const or = (await (await fetchImpl("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) })).json()) as { data?: { id: string; pricing?: RawPricing }[] }
    for (const m of or.data ?? []) if (m.pricing) add("openrouter", m.id, m.pricing)
  } catch (err) {
    logger.warn(`price catalog: OpenRouter refresh failed: ${(err as Error).message}`)
  }
  const vk = process.env.AI_GATEWAY_API_KEY
  if (vk) {
    try {
      const v = (await (await fetchImpl("https://ai-gateway.vercel.sh/v1/models", { headers: { Authorization: `Bearer ${vk}` }, signal: AbortSignal.timeout(20_000) })).json()) as { data?: { id: string; pricing?: RawPricing }[] }
      for (const m of v.data ?? []) if (m.pricing) add("vercel", m.id, m.pricing)
    } catch (err) {
      logger.warn(`price catalog: Vercel refresh failed: ${(err as Error).message}`)
    }
  }
  loadedAt = Date.now()
  logger.info(`price catalog: ${routes.size} routes (${routes.size - before >= 0 ? "+" : ""}${routes.size - before})`)
  return routes.size
}

/** Price for a route, if the catalog knows it. */
export function routePrice(provider: string, model: string): Price | undefined {
  return routes.get(`${provider}:${model}`)
}

export function catalogAgeMs(): number {
  return loadedAt ? Date.now() - loadedAt : Infinity
}

/** Load at startup and refresh daily. */
export function startCatalogRefresh(intervalMs = 24 * 3_600_000): void {
  void refreshCatalog()
  setInterval(() => void refreshCatalog(), intervalMs).unref()
}

/** Test hook. */
export function _setRoute(provider: string, model: string, price: Price | undefined) {
  if (price) routes.set(`${provider}:${model}`, price)
  else routes.delete(`${provider}:${model}`)
}
