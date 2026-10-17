import { API_BASE } from '../api/client'

/**
 * First-party analytics: page views, tracked clicks and identify, sent in batches to our own API
 * (POST /api/t → analytics_events). No third-party scripts, no cookies of its own.
 *
 * - visitor id: a random UUID in localStorage (pw_aid); session id rotates after 30 min idle;
 * - UTM tags and the external referrer are captured once, when a session starts;
 * - any element with data-track="name" records a click (data-track-* attributes become props);
 *   links to other sites record outbound_click;
 * - anonymous visitors with Do Not Track / Global Privacy Control on aren't tracked (the server checks too).
 */
type Ev = { name: string; path?: string; referrer?: string; utm?: Record<string, string>; props?: Record<string, unknown>; ts: number }

const AID = 'pw_aid'
const SID = 'pw_sid'
const SESSION_IDLE_MS = 30 * 60_000
let queue: Ev[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let signedIn = false
// This page load's attribution (UTM tags, external referrer): a new touch even mid-session, sent once.
let landing: { referrer?: string; utm?: Record<string, string> } | null = null
let landingSent = false

const safe = <T,>(f: () => T, fallback: T): T => {
  try {
    return f()
  } catch {
    return fallback
  }
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16)))

function anonId(): string {
  return safe(() => {
    let id = localStorage.getItem(AID)
    if (!id) {
      id = uuid()
      localStorage.setItem(AID, id)
    }
    return id
  }, uuid())
}

/** The current session id; a new session (and new landing attribution) after 30 minutes idle. */
function sessionId(): { id: string; fresh: boolean } {
  return safe(() => {
    const raw = sessionStorage.getItem(SID)
    const now = Date.now()
    const cur = raw ? (JSON.parse(raw) as { id: string; at: number }) : null
    const fresh = !cur || now - cur.at > SESSION_IDLE_MS
    const id = fresh ? uuid() : cur!.id
    sessionStorage.setItem(SID, JSON.stringify({ id, at: now }))
    return { id, fresh }
  }, { id: uuid(), fresh: true })
}

function optedOut(): boolean {
  if (signedIn) return false // signed-in product analytics are part of the service; the server applies the same rule
  const n = navigator as Navigator & { globalPrivacyControl?: boolean }
  return n.doNotTrack === '1' || n.globalPrivacyControl === true
}

function captureLanding() {
  const q = new URLSearchParams(location.search)
  const utm: Record<string, string> = {}
  for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
    const v = q.get(`utm_${k}`)
    if (v) utm[k] = v.slice(0, 150)
  }
  const ref = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : undefined
  landing = { ...(ref ? { referrer: ref } : {}), ...(Object.keys(utm).length ? { utm } : {}) }
}

function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!queue.length) return
  const events = queue.splice(0, 20)
  const body = JSON.stringify({ anonId: anonId(), sessionId: sessionId().id, events })
  // keepalive survives page unloads; credentials let the API see who is signed in (cross-origin in production).
  void fetch(`${API_BASE}/api/t`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'include' }).catch(() => {})
  if (queue.length) flush()
}

export function trackEvent(name: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined' || navigator.webdriver || optedOut()) return // no prerender / automation noise
  sessionId() // keeps the session alive
  if (!landing) captureLanding()
  const ev: Ev = { name, path: location.pathname, ts: Date.now(), ...(props ? { props } : {}) }
  // The page load's attribution rides on its first event (the server keeps it per row).
  if (!landingSent && landing && (landing.referrer || landing.utm)) {
    if (landing.referrer) ev.referrer = landing.referrer
    if (landing.utm) ev.utm = landing.utm
    landingSent = true
  }
  queue.push(ev)
  if (queue.length >= 10) flush()
  else timer ??= setTimeout(flush, 3000)
}

export const trackPageView = () => trackEvent('page_view', { title: document.title.slice(0, 120) })

/** After sign-in: once per account per browser, link this visitor's history to the account. */
export function identifyUser(login: string | null) {
  signedIn = Boolean(login)
  if (!login) return
  const key = `pw_ident:${login}`
  if (safe(() => localStorage.getItem(key), null) || navigator.webdriver) return
  flush() // earlier page views first, so the server can attach them
  // Sent on its own and marked done only once the server has it (a failed send retries next load).
  const body = JSON.stringify({ anonId: anonId(), sessionId: sessionId().id, events: [{ name: 'identify', path: location.pathname, ts: Date.now() }] })
  void fetch(`${API_BASE}/api/t`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'include' })
    .then((r) => r.ok && safe(() => localStorage.setItem(key, '1'), undefined))
    .catch(() => {})
}

let installed = false
/** Click tracking (data-track / outbound links) and flushing when the page is hidden. Call once. */
export function installAnalytics() {
  if (installed || typeof window === 'undefined') return
  installed = true
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-track], a[href]')
      if (!el) return
      if (el.dataset.track) {
        const props: Record<string, unknown> = { label: (el.textContent ?? '').trim().slice(0, 80) }
        for (const [k, v] of Object.entries(el.dataset)) if (k.startsWith('track') && k !== 'track') props[k.slice(5).replace(/^\w/, (c) => c.toLowerCase())] = v
        trackEvent('cta_click', { cta: el.dataset.track, ...props })
        return
      }
      const href = (el as HTMLAnchorElement).href
      if (href && !href.startsWith(location.origin) && /^https?:/.test(href)) trackEvent('outbound_click', { href: href.split('?')[0]!.slice(0, 200) })
    },
    { capture: true },
  )
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  window.addEventListener('pagehide', flush)
}
