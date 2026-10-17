/**
 * Prerender the public pages after `vite build`, so crawlers and link previews get real HTML
 * (headings, copy, per-page meta and JSON-LD) without running JavaScript. The app still boots
 * normally on top (createRoot replaces the snapshot).
 *
 * Serves dist/ with `vite preview`, opens each route in headless Chromium with reduced motion,
 * scrolls the page so every reveal-on-scroll finishes, and writes the HTML to dist/<route>/index.html.
 * Skips (exit 0) when Playwright or a browser isn't available, or with PRERENDER=0.
 *   PW_CHROMIUM=/path/to/chrome  use a specific browser binary
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { preview } from 'vite'

const ROUTES = ['/', '/pricing', '/login']
const dist = path.resolve('dist')

if (process.env.PRERENDER === '0') {
  console.log('prerender: skipped (PRERENDER=0)')
  process.exit(0)
}
let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.warn('prerender: playwright not installed — skipping (pages stay client-rendered)')
  process.exit(0)
}

// The untouched SPA shell stays available as app.html: the fallback for every non-prerendered route
// (dashboard, tasks…), so those never receive Home's content or canonical. See serve.json / _redirects.
copyFileSync(path.join(dist, 'index.html'), path.join(dist, 'app.html'))

const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: 'warn' })
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
let browser
try {
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
} catch (e) {
  console.warn(`prerender: no browser (${String(e.message).split('\n')[0]}) — skipping`)
  await server.close()
  process.exit(0)
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
let failed = 0
for (const route of ROUTES) {
  const page = await ctx.newPage()
  try {
    await page.goto(base + route, { waitUntil: 'networkidle' })
    // Reveal-on-scroll sections animate in only when seen: walk the page, then let them settle.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(1200)
    const html = '<!doctype html>\n' + (await page.evaluate(() => document.documentElement.outerHTML))
    const out = route === '/' ? path.join(dist, 'index.html') : path.join(dist, route.slice(1), 'index.html')
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, html)
    const title = await page.title()
    console.log(`prerender: ${route} → ${path.relative(dist, out)} (${Math.round(html.length / 1024)} KB) "${title}"`)
  } catch (e) {
    failed++
    console.warn(`prerender: ${route} failed: ${e.message}`)
  } finally {
    await page.close()
  }
}
await browser.close()
await server.close()
process.exit(failed ? 1 : 0)
