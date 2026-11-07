#!/usr/bin/env node
/**
 * UI audit: every page at phone, tablet and desktop widths, checked for the bugs a screenshot review misses.
 *
 *   node scripts/ui-audit.mjs [page,page…]
 *
 * Env: BASE (default http://localhost:5174), PW_SESSION (a devin_session cookie value, for the app pages),
 *      PW_CHROMIUM (browser binary), OUT (default ./.ui-audit), SHOTS=0 to skip screenshots.
 *
 * Per page × width it reports:
 *   - overflow   the page scrolls sideways
 *   - offscreen  an element sticks out past the viewport (outside any scroll/clip container)
 *   - clipped    text cut off by overflow:hidden without an ellipsis or line clamp
 *   - overlap    two pieces of text drawn on top of each other
 *   - target     on phone/tablet widths: a button, input or tab under 32 px, or a link under 24 px (WCAG 2.5.8);
 *                inline links in prose excepted
 *   - tiny       visible text under 10 px (the 10–10.5 px mono labels are deliberate)
 *   - image      an image that failed to load
 *   - console    console errors and uncaught page errors
 * and writes OUT/report.json plus a full-page JPEG per page × width.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const OUT = process.env.OUT ?? '.ui-audit'
const SHOTS = process.env.SHOTS !== '0'
const SESSION = process.env.PW_SESSION
const TASK = process.env.PW_TASK ?? ''

const PUBLIC = [
  ['home', '/'],
  ['pricing', '/pricing'],
  ['privacy', '/privacy'],
  ['login', '/login'],
  ['demo', '/demo'],
  ['replay', '/r/8e9c51d8-f35c-4623-b365-5c745a7ae01d'],
]
const APP = [
  ['dashboard', '/dashboard'],
  ['new-task', '/tasks/new'],
  ...(TASK ? [['task', `/tasks/${TASK}`]] : []),
  ['history', '/history'],
  ['wallet', '/wallet'],
  ['settings', '/settings'],
  ['pool', '/admin/pool'],
  ['analytics', '/admin/analytics'],
]
const WIDTHS = [
  [360, 740],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]
const only = process.argv[2]?.split(',')

/** Runs in the page: returns every problem found at the current width. */
function inspect() {
  const vw = window.innerWidth
  const out = []
  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const label = (el) => {
    const id = el.id ? `#${el.id}` : ''
    const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    return `${el.tagName.toLowerCase()}${id}${cls === '.' ? '' : cls} "${text}"`
  }
  // Inside a container that scrolls or clips sideways on purpose (carousels, tables, bleeds)?
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
    }
    return false
  }
  const hidden = (el) => el.closest('[aria-hidden="true"]')
  const block = (el) => { for (let p = el; p; p = p.parentElement) if (!getComputedStyle(p).display.startsWith('inline')) return p; return null }
  const inFixed = (el) => { for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true; return false }
  // The part of an element actually on screen: its box cut down by every ancestor that clips overflow.
  const shown = (el) => {
    let r = el.getBoundingClientRect()
    let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom]
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const q = p.getBoundingClientRect()
      ;[l, t, rt, b] = [Math.max(l, q.left), Math.max(t, q.top), Math.min(rt, q.right), Math.min(b, q.bottom)]
    }
    return rt - l > 0 && b - t > 0 ? { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t } : null
  }

  if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: 'overflow', detail: `page is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport` })

  const all = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'svg', 'path', 'BR'].includes(el.tagName) && !(el instanceof SVGElement))
  for (const el of all) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el) && getComputedStyle(el).position !== 'fixed') {
      out.push({ kind: 'offscreen', detail: `${label(el)} spans ${Math.round(r.left)}…${Math.round(r.right)}` })
    }
  }

  // Text leaves: elements with their own visible text.
  const leaves = all.filter((el) => visible(el) && !hidden(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  for (const el of leaves) {
    const s = getComputedStyle(el)
    const clips = ['hidden', 'clip'].includes(s.overflowX) || ['hidden', 'clip'].includes(s.overflow)
    if (clips && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none' && s.whiteSpace !== 'normal') {
      out.push({ kind: 'clipped', detail: `${label(el)} needs ${el.scrollWidth}px, has ${el.clientWidth}px` })
    }
    if (parseFloat(s.fontSize) < 10) out.push({ kind: 'tiny', detail: `${label(el)} at ${s.fontSize}` })
  }
  // Overlap between text leaves that aren't nested in one another (sampled to keep it fast).
  const rects = leaves.slice(0, 900).map((el) => [el, shown(el)]).filter(([, r]) => r)
  for (let i = 0; i < rects.length; i++) {
    const [a, ra] = rects[i]
    for (let j = i + 1; j < rects.length; j++) {
      const [b, rb] = rects[j]
      if (a.contains(b) || b.contains(a)) continue
      if (inFixed(a) !== inFixed(b)) continue // a fixed bar over scrolling content is by design
      if (block(a) === block(b)) continue // inline pieces of one paragraph: wrapped line boxes, not an overlap
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (w > 4 && h > 4 && w * h > 0.25 * Math.min(ra.width * ra.height, rb.width * rb.height)) {
        out.push({ kind: 'overlap', detail: `${label(a)} × ${label(b)}` })
      }
    }
  }

  if (vw < 1024) {
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="tab"]')) {
      if (!visible(el) || hidden(el) || el.closest('p, li p, dd, td')) continue
      if (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')) continue // the whole label is the target
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
      const r = el.getBoundingClientRect()
      const min = el.tagName === 'A' ? 24 : 32
      if (r.height < min && r.width < 200) out.push({ kind: 'target', detail: `${label(el)} is ${Math.round(r.width)}×${Math.round(r.height)}` })
    }
  }
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && visible(img)) out.push({ kind: 'image', detail: img.currentSrc || img.src })

  // One entry per distinct problem.
  const seen = new Set()
  return out.filter((p) => (seen.has(p.kind + p.detail) ? false : seen.add(p.kind + p.detail)))
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const report = {}
let total = 0
for (const [group, pages] of [['public', PUBLIC], ['app', APP]]) {
  if (group === 'app' && !SESSION) {
    console.log('(skipping app pages: set PW_SESSION)')
    continue
  }
  for (const [w, h] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', isMobile: w < 768, hasTouch: w < 1024 })
    if (group === 'app') await ctx.addCookies([{ name: 'devin_session', value: SESSION, domain: new URL(BASE).hostname, path: '/', httpOnly: true }])
    const page = await ctx.newPage()
    let errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
    for (const [name, path] of pages) {
      if (only && !only.includes(name)) continue
      errors = []
      await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch((e) => errors.push(String(e).slice(0, 200)))
      await page.evaluate(() => document.fonts.ready)
      // Scroll the whole page so reveal-on-scroll content is in its final state.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 40))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(400)
      const problems = await page.evaluate(inspect)
      for (const e of errors) problems.push({ kind: 'console', detail: e })
      const key = `${name}@${w}`
      report[key] = problems
      total += problems.length
      const counts = Object.entries(problems.reduce((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {})).map(([k, n]) => `${k} ${n}`)
      console.log(`${key.padEnd(18)} ${counts.length ? counts.join(' · ') : 'clean'}`)
      if (SHOTS) await page.screenshot({ path: `${OUT}/${name}-${w}.jpg`, type: 'jpeg', quality: 70, fullPage: true })
    }
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(`\n${total} problems · ${OUT}/report.json`)
process.exit(0)
