/**
 * One-time Dodo Payments setup for an environment (test or live, from DODO_ENV).
 *
 *   npx tsx --env-file=.env scripts/pw/dodo-setup.mts product            # create the $8/month Pro product
 *   npx tsx --env-file=.env scripts/pw/dodo-setup.mts webhook <https-url> # register <url>/api/webhooks/dodo
 *
 * Prints the env lines to add (DODO_PRO_PRODUCT_ID, DODO_WEBHOOK_SECRET); never prints the API key.
 * Webhooks need a public HTTPS backend — Dodo can't reach localhost. Locally, Settings confirms a
 * checkout through POST /api/billing/sync instead.
 */
const live = process.env.DODO_ENV === "live_mode"
const base = live ? "https://live.dodopayments.com" : "https://test.dodopayments.com"
const key = process.env.DODO_API_KEY
if (!key) throw new Error("DODO_API_KEY missing")

async function dodo<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

const [cmd, arg] = process.argv.slice(2)
console.log(`Dodo ${live ? "LIVE" : "test"} mode`)

if (cmd === "product") {
  const p = await dodo<{ product_id: string }>("/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Pullwright Pro",
      description: "25 tasks a day, three at once, priority queue, and $3 of model usage every month.",
      tax_category: "saas",
      price: {
        type: "recurring_price",
        currency: "USD",
        price: 800, // cents
        discount: 0,
        purchasing_power_parity: false,
        payment_frequency_count: 1,
        payment_frequency_interval: "Month",
        subscription_period_count: 10,
        subscription_period_interval: "Year",
        tax_inclusive: false,
      },
    }),
  })
  console.log(`DODO_PRO_PRODUCT_ID=${p.product_id}`)
} else if (cmd === "webhook" && arg?.startsWith("https://")) {
  const url = `${arg.replace(/\/$/, "")}/api/webhooks/dodo`
  const w = await dodo<{ id: string }>("/webhooks", {
    method: "POST",
    body: JSON.stringify({
      url,
      description: "Pullwright subscriptions",
      // Exactly the events billing/index.ts acts on.
      filter_types: [
        "subscription.active", "subscription.renewed", "subscription.unpaused", "subscription.plan_changed", "subscription.updated",
        "subscription.past_due", "subscription.on_hold", "subscription.paused", "subscription.failed", "subscription.cancelled", "subscription.expired",
      ],
    }),
  })
  const { secret } = await dodo<{ secret: string }>(`/webhooks/${w.id}/secret`)
  console.log(`Webhook ${w.id} → ${url}`)
  console.log(`DODO_WEBHOOK_SECRET=${secret}`)
} else {
  console.log("usage: dodo-setup.mts product | webhook <https://your-backend>")
  process.exit(1)
}
