import { Router } from "express"
import crypto from "crypto"
import logger from "../logger.js"
import { createRedisClient } from "../config/redis.js"
import { SessionStore, SESSION_COOKIE } from "../auth/session.js"
import { upsertUserByGithubId } from "../repositories/userRepository.js"
import { isDatabaseEnabled } from "../db/prisma.js"

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize"
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
const GITHUB_USER_URL = "https://api.github.com/user"

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? "http://localhost:5173"
}

function backendUrl(): string {
  return process.env.BACKEND_URL ?? `http://localhost:${process.env.PORT ?? 3500}`
}

// Cookies must be cross-site (SameSite=None; Secure) in production so the SPA
// on another origin keeps the session; localhost uses Lax over http.
function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production"
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
  }
}

const STATE_COOKIE = "pw_oauth_state"

/** Only same-site relative paths — never "//evil.com" or absolute URLs (open redirect). */
function safeReturnTo(v: unknown): string {
  return typeof v === "string" && /^\/(?!\/)[\w\-./?=&%#]*$/.test(v) ? v : "/dashboard"
}

export function createOAuthRouter(sessionStore: SessionStore) {
  const router = Router()
  const redis = createRedisClient()

  // Step 1 — redirect the user to GitHub's consent screen.
  router.get("/github", (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID
    if (!clientId) {
      return res.status(500).json({ error: "GitHub OAuth is not configured (missing GITHUB_CLIENT_ID)" })
    }
    const returnTo = safeReturnTo(req.query.returnTo)
    // CSRF protection: random state bound to this browser (cookie) and stored server-side (single use).
    const state = crypto.randomBytes(24).toString("base64url")
    void redis.set(`oauth:${state}`, returnTo, "EX", 600)
    res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600_000, path: "/" })

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${backendUrl()}/api/auth/github/callback`,
      scope: "repo read:user",
      state,
      allow_signup: "true",
    })
    res.redirect(`${GITHUB_AUTHORIZE}?${params.toString()}`)
  })

  // Step 2 — GitHub redirects back with a code; exchange it for a token.
  router.get("/github/callback", async (req, res) => {
    const code = req.query.code as string | undefined
    const state = typeof req.query.state === "string" ? req.query.state : ""
    const cookieState = req.cookies?.[STATE_COOKIE] as string | undefined
    res.clearCookie(STATE_COOKIE, { path: "/" })
    const stored = state ? await redis.getdel(`oauth:${state}`) : null
    if (!state || !cookieState || state !== cookieState || stored === null) {
      logger.warn("OAuth callback rejected: state mismatch")
      return res.redirect(`${frontendUrl()}/login?error=state_mismatch`)
    }
    const returnTo = safeReturnTo(stored)

    if (!code) return res.redirect(`${frontendUrl()}/login?error=missing_code`)

    try {
      const tokenRes = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${backendUrl()}/api/auth/github/callback`,
        }),
      })
      const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
      const accessToken = tokenJson.access_token
      if (!accessToken) {
        logger.error(`OAuth token exchange failed: ${tokenJson.error ?? "no access_token"}`)
        return res.redirect(`${frontendUrl()}/login?error=token_exchange`)
      }

      const userRes = await fetch(GITHUB_USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      })
      if (!userRes.ok) {
        const body = await userRes.text()
        logger.error(`GitHub /user failed (${userRes.status}): ${body}`)
        return res.redirect(`${frontendUrl()}/login?error=oauth_failed`)
      }

      const user = (await userRes.json()) as {
        id?: number
        login: string
        name?: string
        avatar_url: string
        email?: string
      }

      if (!user.login || !user.avatar_url) {
        logger.error("GitHub /user response missing required fields: " + JSON.stringify(user))
        return res.redirect(`${frontendUrl()}/login?error=oauth_failed`)
      }

      let userId: string | undefined
      if (isDatabaseEnabled()) {
        if (!user.id) {
          logger.error("GitHub /user response missing id — cannot persist user")
        } else {
          try {
            const persisted = await upsertUserByGithubId({
              githubId: BigInt(user.id),
              login: user.login,
              ...(user.name ? { name: user.name } : {}),
              avatarUrl: user.avatar_url,
              ...(user.email ? { email: user.email } : {}),
            })
            if (persisted) {
              userId = persisted
              logger.info(`User persisted to Postgres: ${user.login} (${persisted})`)
            } else {
              logger.error(`User upsert returned null for ${user.login}`)
            }
          } catch (dbError) {
            logger.error(
              `Failed to persist user to Postgres: ${dbError instanceof Error ? dbError.message : dbError}`,
              { login: user.login, githubId: user.id },
            )
          }
        }
      } else {
        logger.warn("DATABASE_URL not set — user stored in Redis session only")
      }

      const sessionId = await sessionStore.create({
        ...(userId ? { userId } : {}),
        login: user.login,
        ...(user.name ? { name: user.name } : {}),
        avatarUrl: user.avatar_url,
        accessToken,
        createdAt: new Date().toISOString(),
      })

      res.cookie(SESSION_COOKIE, sessionId, cookieOptions())
      logger.info("User signed in: " + user.login)
      res.redirect(`${frontendUrl()}${returnTo}`)
    } catch (error) {
      logger.error("OAuth callback error: " + error)
      res.redirect(`${frontendUrl()}/login?error=oauth_failed`)
    }
  })

  // Local development only: sign in as the owner of GITHUB_TOKEN without the OAuth round trip
  // (the OAuth app's callback URL points at production). Disabled unless ENABLE_DEV_LOGIN=1,
  // never in production, and only from loopback.
  router.get("/dev-login", async (req, res) => {
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_DEV_LOGIN !== "1" || !loopback || !process.env.GITHUB_TOKEN) {
      return res.status(404).json({ error: "Not found" })
    }
    const accessToken = process.env.GITHUB_TOKEN
    const userRes = await fetch(GITHUB_USER_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" } })
    if (!userRes.ok) return res.status(502).json({ error: "GITHUB_TOKEN is not valid" })
    const user = (await userRes.json()) as { id: number; login: string; name?: string; avatar_url: string; email?: string }
    let userId: string | undefined
    if (isDatabaseEnabled()) {
      userId =
        (await upsertUserByGithubId({
          githubId: BigInt(user.id),
          login: user.login,
          ...(user.name ? { name: user.name } : {}),
          avatarUrl: user.avatar_url,
          ...(user.email ? { email: user.email } : {}),
        })) ?? undefined
    }
    const sessionId = await sessionStore.create({
      ...(userId ? { userId } : {}),
      login: user.login,
      ...(user.name ? { name: user.name } : {}),
      avatarUrl: user.avatar_url,
      accessToken,
      createdAt: new Date().toISOString(),
    })
    res.cookie(SESSION_COOKIE, sessionId, cookieOptions())
    logger.warn(`DEV LOGIN used for ${user.login}`)
    res.redirect(`${frontendUrl()}${safeReturnTo(req.query.returnTo)}`)
  })

  // Current user (public fields only).
  router.get("/me", (req, res) => {
    if (!req.session) return res.status(200).json({ user: null })
    const { userId, login, name, avatarUrl } = req.session
    res.status(200).json({
      user: {
        ...(userId ? { id: userId } : {}),
        login,
        name,
        avatarUrl,
      },
    })
  })

  // Short-lived token so EventSource (which can't send headers) can authenticate.
  router.get("/stream-token", async (req, res) => {
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined
    if (!sid) return res.status(401).json({ error: "Unauthorized" })
    const token = await sessionStore.issueStreamToken(sid)
    res.status(200).json({ token })
  })

  router.post("/logout", async (req, res) => {
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined
    if (sid) await sessionStore.destroy(sid)
    res.clearCookie(SESSION_COOKIE, { path: "/" })
    res.status(200).json({ ok: true })
  })

  return router
}
