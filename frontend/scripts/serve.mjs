/**
 * Production static server for dist/ (npm start). Explicit routing instead of a generic SPA server:
 *   1. a real file → that file (assets get a year of immutable cache; HTML is revalidated);
 *   2. a route with a prerendered page (dist/<route>/index.html, or dist/index.html for "/") → it;
 *   3. anything else → app.html, the bare SPA shell (so app routes never get Home's content/canonical).
 * Behind Cloudflare Pages the same rules live in public/_redirects.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'dist')
const port = Number(process.env.PORT ?? 3000)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4' }

const isFile = (p) => existsSync(p) && statSync(p).isFile()
function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const target = path.join(root, clean)
  if (!target.startsWith(root)) return null
  if (isFile(target)) return target
  const page = path.join(target, 'index.html')
  if (isFile(page)) return page
  return path.join(root, 'app.html')
}

createServer((req, res) => {
  const file = resolve(req.url ?? '/')
  if (!file || !isFile(file)) {
    res.writeHead(404).end('Not found')
    return
  }
  const ext = path.extname(file)
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  createReadStream(file).pipe(res)
}).listen(port, '0.0.0.0', () => console.log(`serving ${root} on :${port}`))
