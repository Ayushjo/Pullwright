import express, { Router } from "express"
import { z } from "zod"
import { requireAuth } from "./auth.js"
import { isDatabaseEnabled } from "../db/prisma.js"
import {
  GUIDES,
  WALLET_PROVIDERS,
  checkKey,
  deleteWalletKey,
  detectWalletProvider,
  listWallet,
  loadWallet,
  saveWalletKey,
  type WalletProvider,
} from "../wallet/credentials.js"
import { walletCapability } from "../wallet/routing.js"
import { track } from "../analytics/track.js"

const AddKey = z.object({
  key: z.string().trim().min(16).max(400),
  provider: z.enum(["gemini", "groq", "vercel", "openrouter", "openai"]).optional(),
})

/** The user's model keys (P4 wallet), mounted under /api. Keys never leave the server once saved. */
export function createWalletRouter() {
  const router = Router()
  router.use(requireAuth)
  const needUser = (req: express.Request, res: express.Response) => {
    if (!isDatabaseEnabled() || !req.session?.userId) {
      res.status(401).json({ error: "Sign in again" })
      return null
    }
    return req.session.userId
  }

  const view = async (userId: string) => {
    const keys = await listWallet(userId)
    const loaded = await loadWallet(userId)
    return {
      keys,
      capability: walletCapability(loaded),
      providers: WALLET_PROVIDERS.map((p) => {
        const g = GUIDES[p]
        return { id: g.id, name: g.name, role: g.role, free: g.free, cardNeeded: g.cardNeeded, keyUrl: g.keyUrl, steps: g.steps, placeholder: g.placeholder }
      }),
    }
  }

  router.get("/wallet", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    res.json(await view(userId))
  })

  router.post("/wallet/keys", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const parsed = AddKey.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Paste the whole key" })
    const key = parsed.data.key
    const provider = parsed.data.provider ?? detectWalletProvider(key)
    if (!provider) return res.status(400).json({ error: "We don't recognise that key. Pick the provider and try again." })
    if (!GUIDES[provider].pattern.test(key)) return res.status(400).json({ error: `That doesn't look like a ${GUIDES[provider].name} key (${GUIDES[provider].placeholder}).` })
    const checked = await checkKey(provider, key)
    if ("error" in checked) {
      track("key_rejected", { userId, req, props: { provider } })
      return res.status(400).json({ error: checked.error })
    }
    await saveWalletKey(userId, provider, key, checked)
    track("key_added", { userId, req, props: { provider, tier: (checked as { tier?: string }).tier ?? null } })
    res.json({ ...(await view(userId)), added: provider })
  })

  router.post("/wallet/keys/:provider/check", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const provider = String(req.params.provider) as WalletProvider
    const k = (await loadWallet(userId)).find((x) => x.provider === provider)
    if (!k) return res.status(404).json({ error: "No key for that provider" })
    const checked = await checkKey(provider, k.key)
    if ("error" in checked) return res.status(400).json({ error: checked.error })
    await saveWalletKey(userId, provider, k.key, checked)
    res.json(await view(userId))
  })

  router.delete("/wallet/keys/:provider", async (req, res) => {
    const userId = needUser(req, res)
    if (!userId) return
    const provider = String(req.params.provider) as WalletProvider
    if (!WALLET_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Unknown provider" })
    await deleteWalletKey(userId, provider)
    track("key_removed", { userId, req, props: { provider } })
    res.json(await view(userId))
  })

  return router
}
