import { Redis } from "ioredis"
import crypto from "crypto"
import { createRedisClient } from "../config/redis.js"

export type SessionData = {
  userId?: string
  login: string
  name?: string
  avatarUrl: string
  accessToken: string
  createdAt: string
}

// Public view of a session (never leaks the access token to the client).
export type SessionPublic = {
  id?: string
  login: string
  name?: string
  avatarUrl: string
}

const ALGO = "aes-256-gcm"

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production")
    return crypto.createHash("sha256").update("dev-insecure-session-secret-change-me").digest()
  }
  // Derive a stable 32-byte key from the secret.
  return crypto.createHash("sha256").update(secret).digest()
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":")
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":")
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed ciphertext")
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

export class SessionStore {
  private redis: Redis
  private TTL = 60 * 60 * 24 * 7 // 7 days

  constructor() {
    this.redis = createRedisClient()
  }

  private key(sessionId: string) {
    return `session:${sessionId}`
  }

  async create(data: SessionData): Promise<string> {
    const sessionId = crypto.randomBytes(24).toString("hex")
    const toStore = { ...data, accessToken: encrypt(data.accessToken) }
    await this.redis.set(this.key(sessionId), JSON.stringify(toStore), "EX", this.TTL)
    return sessionId
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const raw = await this.redis.get(this.key(sessionId))
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as SessionData
      return { ...parsed, accessToken: decrypt(parsed.accessToken) }
    } catch {
      return null
    }
  }

  async destroy(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId))
  }

  // Short-lived one-time token used to authenticate SSE (EventSource can't set headers).
  async issueStreamToken(sessionId: string): Promise<string> {
    const token = crypto.randomBytes(16).toString("hex")
    await this.redis.set(`stream:${token}`, sessionId, "EX", 60)
    return token
  }

  async resolveStreamToken(token: string): Promise<string | null> {
    // Single use: a leaked stream token can't be replayed.
    return this.redis.getdel(`stream:${token}`)
  }
}

export const SESSION_COOKIE = "devin_session"
