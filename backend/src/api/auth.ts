import crypto from "crypto"
import type { Request, Response, NextFunction } from "express"
import { SessionStore, SESSION_COOKIE, type SessionData } from "../auth/session.js"

// Augment Express request with the resolved session.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionData
      /** Authenticated with the operator API_TOKEN (scripts / evals), not a user session. */
      isOperator?: boolean
    }
  }
}

/**
 * Attaches the authenticated session (if any) to req.session.
 * Resolves auth in this order:
 *   1. httpOnly session cookie
 *   2. short-lived stream token in ?token= (for SSE EventSource)
 */
export function attachSession(sessionStore: SessionStore) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const cookieSid = req.cookies?.[SESSION_COOKIE] as string | undefined
      let sessionId = cookieSid

      if (!sessionId && typeof req.query.token === "string") {
        const resolved = await sessionStore.resolveStreamToken(req.query.token)
        if (resolved) sessionId = resolved
      }

      if (sessionId) {
        const session = await sessionStore.get(sessionId)
        if (session) req.session = session
      }
    } catch {
      /* ignore — treated as unauthenticated */
    }
    next()
  }
}

/**
 * Requires an authenticated session, or the operator API_TOKEN as a Bearer header
 * (used by scripts/evals; never accepted in query strings). Fails closed.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session) return next()

  const token = process.env.API_TOKEN
  if (token && token.length >= 24) {
    const header = req.headers.authorization ?? ""
    const given = Buffer.from(header)
    const want = Buffer.from(`Bearer ${token}`)
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) {
      req.isOperator = true
      return next()
    }
  }

  res.status(401).json({ error: "Sign in required" })
}
