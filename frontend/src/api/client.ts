import type { TaskState, TaskEvent, DiffStat } from '../types/task'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
// All requests send cookies so the httpOnly session works cross-origin.
const CREDENTIALS: RequestCredentials = 'include'

export const API_BASE = BASE

/** Error carrying the server's own message (never a generic "is the backend running?"). */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
    throw new ApiError(msg, res.status)
  }
  return data as T
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

export type CreateTaskOptions = { autoApprove?: boolean; autoPublish?: boolean; draft?: boolean }

export function createTask(issueUrl: string, options: CreateTaskOptions = {}) {
  return post<{ taskId: string; status: string }>('/api/task', { issueUrl, ...options })
}

export function openTaskStream(taskId: string, afterSeq = -1): EventSource {
  const qs = afterSeq >= 0 ? `?after=${afterSeq}` : ''
  return new EventSource(`${BASE}/api/task/${taskId}/stream${qs}`, { withCredentials: true })
}

export async function getTaskEvents(taskId: string): Promise<TaskEvent[]> {
  try {
    return await request<TaskEvent[]>(`/api/task/${taskId}/events`)
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
export const cancelTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/cancel`)
export const publishTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/publish`)
export const retryTask = (taskId: string) => post<{ ok: true }>(`/api/task/${taskId}/retry`)
export const restoreCheckpoint = (taskId: string, sha: string) => post<{ ok: true }>(`/api/task/${taskId}/restore`, { sha })
export const setFileRejected = (taskId: string, path: string, rejected: boolean) =>
  post<{ rejectedFiles: string[] }>(`/api/task/${taskId}/files`, { path, rejected })
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
