import type { TaskState, TaskEvent, DiffStat } from '../types/task'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
// All requests send cookies so the httpOnly session works cross-origin.
const CREDENTIALS: RequestCredentials = 'include'

export const API_BASE = BASE

/** Error carrying the server's own message (never a generic "is the backend running?"). */
export class ApiError extends Error {
  readonly status: number
  /** Machine-readable reason from the server, e.g. "daily_limit", "private_repo_training". */
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: CREDENTIALS,
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
    })
  } catch {
    throw new ApiError('Can’t reach the Pullwright API. Check your connection and try again.', 0)
  }
  const text = await res.text()
  const data = parseJson(text)
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) ?? (res.status === 401 ? 'Please sign in again.' : `Request failed (${res.status})`)
    const code = data && typeof data === 'object' && 'code' in data && typeof (data as { code: unknown }).code === 'string' ? (data as { code: string }).code : undefined
    throw new ApiError(msg, res.status, code)
  }
  return data as T
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

export type CreateTaskOptions = { autoApprove?: boolean; autoPublish?: boolean; draft?: boolean; allowTraining?: boolean }

export function createTask(issueUrl: string, options: CreateTaskOptions = {}) {
  return post<{ taskId: string; status: string }>('/api/task', { issueUrl, ...options })
}

export function openTaskStream(taskId: string, afterSeq = -1): EventSource {
  const qs = afterSeq >= 0 ? `?after=${afterSeq}` : ''
  return new EventSource(`${BASE}/api/task/${taskId}/stream${qs}`, { withCredentials: true })
}

export async function getTaskEvents(taskId: string, afterSeq = -1): Promise<TaskEvent[]> {
  try {
    return await request<TaskEvent[]>(`/api/task/${taskId}/events${afterSeq >= 0 ? `?after=${afterSeq}` : ''}`)
  } catch {
    return []
  }
}

export async function getTask(taskId: string): Promise<TaskState | null> {
  try {
    return await request<TaskState>(`/api/task/${taskId}`)
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null
    throw e
  }
}

/** Legacy alias used by older pages. */
export async function getTaskState(taskId: string): Promise<Record<string, unknown> | null> {
  return (await getTask(taskId).catch(() => null)) as Record<string, unknown> | null
}

export async function getTaskMetrics(taskId: string) {
  try {
    return await request<Record<string, unknown>>(`/api/task/${taskId}/metrics`)
  } catch {
    return null
  }
}

export const approvePlan = (taskId: string, body: { steps?: { title: string; files: string[] }[]; requirements?: string[]; note?: string } = {}) =>
  post<{ ok: true }>(`/api/task/${taskId}/approve`, body)
export const sendMessage = (taskId: string, text: string) => post<{ ok: true; resumed?: boolean }>(`/api/task/${taskId}/message`, { text })
/** Send changed plan decisions back to the planner (the plan is rebuilt around them). */
/** Resume a paused (parked) task now, e.g. after adding a key. */
export const resumeTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/resume`)
export const replanTask = (taskId: string, text: string) => post<{ ok: true }>(`/api/task/${taskId}/replan`, { text })

/** An issue image Pullwright downloaded, as an object URL (fetched with the session cookie). */
export async function attachmentObjectUrl(taskId: string, n: number): Promise<string | null> {
  try {
    // Revalidate (ETag) rather than trust a cached response: a stale 404 would hide an available image.
    const res = await fetch(`${BASE}/api/task/${taskId}/attachments/${n}`, { credentials: CREDENTIALS, cache: 'no-cache' })
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch {
    return null
  }
}
export const cancelTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/cancel`)
export const publishTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/publish`)
export const retryTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/retry`)
export const restoreCheckpoint = (taskId: string, sha: string) => post<{ ok: true }>(`/api/task/${taskId}/restore`, { sha })
export const setFileRejected = (taskId: string, path: string, rejected: boolean) =>
  post<{ rejectedFiles: string[] }>(`/api/task/${taskId}/files`, { path, rejected })
export const extendBudget = (taskId: string, addUsd: number) => post<{ ok: true; capUsd: number }>(`/api/task/${taskId}/extend`, { addUsd })
export const shareTask = (taskId: string, isPublic: boolean) => post<{ isPublic: boolean }>(`/api/task/${taskId}/share`, { public: isPublic })
export const getDiff = (taskId: string) =>
  request<{ patch: string; stats: DiffStat[]; rejectedFiles: string[]; acceptedPatch: string }>(`/api/task/${taskId}/diff`)

export async function listTasks() {
  try {
    const data = await request<unknown>('/api/tasks')
    if (Array.isArray(data)) return data
    return (data as { tasks?: unknown[] })?.tasks ?? []
  } catch {
    return []
  }
}

export type StatsResponse = {
  total: number
  running: number
  done: number
  failed: number
  queued: number
  needsYou?: number
  totalCostUsd?: number
}

export async function getStats(): Promise<StatsResponse | null> {
  try {
    return await request<StatsResponse>('/api/stats')
  } catch {
    return null
  }
}

/* ── Public replays ── */
export const getPublicTask = (taskId: string) => request<Record<string, unknown>>(`/api/public/task/${taskId}`)
export const getPublicEvents = (taskId: string) => request<TaskEvent[]>(`/api/public/task/${taskId}/events`)

/* ── Auth ── */
export type AuthUser = { login: string; name?: string; avatarUrl: string }

export async function getMe(): Promise<AuthUser | null> {
  try {
    const data = await request<{ user: AuthUser | null }>('/api/auth/me')
    return data?.user ?? null
  } catch {
    return null
  }
}

export function githubLoginUrl(returnTo?: string): string {
  const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  return `${BASE}/api/auth/github${qs}`
}

export async function logout(): Promise<void> {
  try {
    await post('/api/auth/logout')
  } catch {
    /* ignore */
  }
}

/* ── Billing & keys ── */
export type KeyProvider = 'openai' | 'openrouter'
export type BillingInfo = {
  entitlement: {
    tier: 'free' | 'pro'
    runsIncluded: number
    runsUsed: number
    hostedAllowanceUsd: number
    hostedSpentUsd: number
    key:
      | { kind: 'byok'; provider: KeyProvider }
      | { kind: 'platform'; fundedBy: 'credits'; capUsd: number; trialOnly: boolean }
      | { kind: 'platform'; fundedBy: 'free_claude'; capUsd: number; model: string }
      | { kind: 'wallet'; allFree: boolean }
      | null
    credits: CreditSummary | null
    free: FreeAllowance | null
    reason?: string
  }
  keys: { provider: KeyProvider; last4: string; model: string | null; createdAt: string; lastUsedAt: string | null }[]
  subscription: { tier: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null
  paymentsEnabled: boolean
  packEnabled?: boolean
}
export const getBilling = () => request<BillingInfo>('/api/billing')
export const saveApiKey = (provider: KeyProvider, key: string, model?: string) =>
  post<{ keys: BillingInfo['keys'] }>('/api/keys', { provider, key, ...(model ? { model } : {}) })
export const deleteApiKey = (provider: KeyProvider) => request<{ keys: BillingInfo['keys'] }>(`/api/keys/${provider}`, { method: 'DELETE' })
export const startCheckout = (kind: 'pro' | 'pack' = 'pro') => post<{ url: string }>('/api/billing/checkout', { kind })
export const openBillingPortal = () => post<{ url: string }>('/api/billing/portal')
/** After checkout: ask the server to confirm the subscription with Dodo (doesn't wait for the webhook). */
export const syncBilling = () => post<{ status: string }>('/api/billing/sync')

/* ── Free monthly Claude allowance ── */
export type FreeAllowance = {
  enabled: boolean
  ineligible?: string
  limit: number
  used: number
  left: number
  renewsAt: string
  poolOpen: boolean
  poolOpensAt?: string
  model: string
}

/* ── Credits (Pro's monthly usage, packs, the trial) ── */
export type CreditSummary = {
  balanceUsd: number
  /** Balance minus what running credit-funded tasks could still spend. */
  availableUsd: number
  trialOnly: boolean
  nextExpiry: { atIso: string; usd: number } | null
  overdraftUsd: number
  grantRemainingUsd: number
}
export type CreditRow = { kind: 'grant' | 'purchase' | 'trial' | 'debit' | 'refund' | 'adjust'; usd: number; note: string | null; taskId: string | null; expiresAt: string | null; createdAt: string }
export type CreditsView = {
  summary: CreditSummary
  history: CreditRow[]
  trial: { available: boolean; claimed: boolean; usd: number }
  pack: { enabled: boolean; priceUsd: number; creditUsd: number; validDays: number }
}
export const getCredits = () => request<CreditsView>('/api/credits')
export const claimTrial = () => post<{ ok: true; usd: number; expiresAt: string; summary: CreditSummary }>('/api/credits/trial')

/* ── Wallet (free and paid model keys) ── */
export type WalletProvider = 'gemini' | 'groq' | 'vercel' | 'openrouter' | 'openai'
export type WalletKey = {
  provider: WalletProvider
  last4: string
  tier: 'free' | 'paid' | 'free_credit' | 'unknown' | string
  status: 'active' | 'revoked' | 'out_of_funds' | string
  dataPolicy: 'trains' | 'no_train' | 'unknown' | string
  meta: {
    balanceUsd?: number | null
    usedUsd?: number | null
    limitRemainingUsd?: number | null
    freeRequestsToday?: { used: number; limit: number; remaining: number }
  } | null
  createdAt: string
  lastUsedAt: string | null
  lastCheckedAt: string | null
}
export type WalletGuide = { id: WalletProvider; name: string; role: string; free: boolean; cardNeeded: boolean; keyUrl: string; steps: string[]; placeholder: string }
export type WalletCapability = { canRun: boolean; canReview: boolean; canReadImages: boolean; allFree: boolean; missing: string | null }
export type WalletView = { keys: WalletKey[]; capability: WalletCapability; providers: WalletGuide[] }

export const getWallet = () => request<WalletView>('/api/wallet')
export const addWalletKey = (key: string, provider?: WalletProvider) =>
  post<WalletView & { added: WalletProvider }>('/api/wallet/keys', { key, ...(provider ? { provider } : {}) })
export const checkWalletKey = (provider: WalletProvider) => post<WalletView>(`/api/wallet/keys/${provider}/check`)
export const deleteWalletKey = (provider: WalletProvider) => request<WalletView>(`/api/wallet/keys/${provider}`, { method: 'DELETE' })

/* ── Capacity (free plan: 3 starts per rolling 24 h) ── */
export type Capacity = { tier: 'free' | 'pro'; tasksPerDay: number; used: number; left: number; nextSlotAt: number | null; maxActive: number; active: number }
export const getCapacity = () => request<Capacity>('/api/capacity')
