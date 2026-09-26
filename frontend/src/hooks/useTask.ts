import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskEvent, TaskState } from '../types/task'
import { getTask, getTaskEvents, openTaskStream } from '../api/client'
import { statusMeta } from '../lib/status'

/**
 * Live task state + event log.
 * Events are keyed by their sequence number (index in the durable log), so replay,
 * SSE and polling can never duplicate or reorder them. The browser's EventSource
 * reconnects automatically and resumes from Last-Event-ID.
 */
export function useTask(taskId: string) {
  const [state, setState] = useState<TaskState | null>(null)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [eventsLoaded, setEventsLoaded] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await getTask(taskId)
      if (!s) setNotFound(true)
      else {
        setState(s)
        setNotFound(false)
      }
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [taskId])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, 350)
  }, [refresh])

  const resyncEvents = useCallback(async () => {
    const all = await getTaskEvents(taskId)
    setEvents((prev) => (all.length >= prev.length ? all : prev))
    return all.length
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    let closed = false
    let source: EventSource | null = null

    void (async () => {
      await refresh()
      const count = await resyncEvents()
      if (closed) return
      setLoading(false)
      setEventsLoaded(true)
      source = openTaskStream(taskId, count - 1)
      source.onopen = () => setConnected(true)
      source.onerror = () => setConnected(false) // EventSource retries on its own
      source.onmessage = (msg: MessageEvent<string>) => {
        const seq = Number(msg.lastEventId)
        let ev: TaskEvent
        try {
          ev = JSON.parse(msg.data) as TaskEvent
        } catch {
          return
        }
        setEvents((prev) => {
          if (!Number.isFinite(seq)) return [...prev, ev]
          if (seq < prev.length) return prev // already have it
          if (seq > prev.length) {
            void resyncEvents() // gap — fetch the full log
            return prev
          }
          return [...prev, ev]
        })
        if (['status', 'plan_ready', 'gate_result', 'judge_result', 'diff_ready', 'pr_opened', 'task_failed', 'task_complete', 'question', 'cost'].includes(ev.type)) {
          scheduleRefresh()
        }
      }
    })()

    return () => {
      closed = true
      source?.close()
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [taskId, refresh, resyncEvents, scheduleRefresh])

  // Safety net: poll state while the task is active (covers proxies that buffer SSE).
  const active = state ? statusMeta(state.status).active : true
  useEffect(() => {
    if (!taskId || !active) return
    const id = setInterval(() => {
      void refresh()
      void resyncEvents()
    }, 6000)
    return () => clearInterval(id)
  }, [taskId, active, refresh, resyncEvents])

  return { state, setState, events, eventsLoaded, loading, notFound, error, connected, refresh }
}
