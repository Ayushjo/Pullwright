import { describe, it, expect } from "vitest"
import crypto from "crypto"
import { verifyWebhook } from "../index.js"

const secretBytes = crypto.randomBytes(24)
const secret = `whsec_${secretBytes.toString("base64")}`
const sign = (id: string, ts: string, body: string, key = secretBytes) =>
  `v1,${crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`

describe("Dodo webhook verification (Standard Webhooks)", () => {
  const body = JSON.stringify({ type: "subscription.active", data: { subscription_id: "sub_1", metadata: { user_id: "u1" } } })
  const now = String(Math.floor(Date.now() / 1000))

  it("accepts a valid signature (incl. multiple signatures in the header)", () => {
    const h = { "webhook-id": "msg_1", "webhook-timestamp": now, "webhook-signature": `v1,bogus ${sign("msg_1", now, body)}` }
    expect(verifyWebhook(body, h, secret)).toBe(true)
  })
  it("rejects a tampered body", () => {
    const h = { "webhook-id": "msg_1", "webhook-timestamp": now, "webhook-signature": sign("msg_1", now, body) }
    expect(verifyWebhook(body.replace("u1", "u2"), h, secret)).toBe(false)
  })
  it("rejects stale timestamps and wrong secrets", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600)
    expect(verifyWebhook(body, { "webhook-id": "m", "webhook-timestamp": old, "webhook-signature": sign("m", old, body) }, secret)).toBe(false)
    expect(verifyWebhook(body, { "webhook-id": "m", "webhook-timestamp": now, "webhook-signature": sign("m", now, body, crypto.randomBytes(24)) }, secret)).toBe(false)
    expect(verifyWebhook(body, { "webhook-id": "m", "webhook-timestamp": now, "webhook-signature": sign("m", now, body) }, undefined)).toBe(false)
  })
})

describe("OpenRouter key info", () => {
  it("keeps tier, limits and today's free-model requests", async () => {
    const { openRouterKeyInfo } = await import("../index.js")
    const info = openRouterKeyInfo({
      data: { is_free_tier: true, limit: null, limit_remaining: null, usage: 0, free_model_daily_requests: { used: 3, limit: 50, remaining: 47 } },
    })
    expect(info).toEqual({ tier: "free", limitUsd: null, limitRemainingUsd: null, freeRequestsToday: { used: 3, limit: 50, remaining: 47 } })
    expect(openRouterKeyInfo({ data: { is_free_tier: false, limit: 20, limit_remaining: 12.5 } })).toEqual({ tier: "paid", limitUsd: 20, limitRemainingUsd: 12.5 })
    expect(openRouterKeyInfo(null)).toEqual({ tier: "unknown" })
  })
})
