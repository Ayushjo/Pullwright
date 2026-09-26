import http from 'node:http'
import { Router } from './router.js'
import { Inventory } from './inventory.js'
import { Cart } from './cart.js'
import { formatCurrency } from './format.js'

/**
 * Build the request handler. Exported separately so tests can call it without a socket.
 * @param {Inventory} inventory
 */
export function createApp(inventory = Inventory.fromFile()) {
  const router = new Router()

  router.get('/health', () => ({ status: 200, body: { status: 'ok' } }))

  router.get('/books', () => ({ status: 200, body: inventory.list() }))

  router.get('/books/:id', ({ params }) => {
    const book = inventory.find(params.id)
    if (!book) return { status: 404, body: { error: 'Book not found' } }
    return { status: 200, body: book }
  })

  router.post('/cart/quote', ({ body }) => {
    const cart = new Cart(inventory)
    for (const item of body.items) cart.addItem(item.id, item.quantity)
    if (body.discountCode) cart.applyDiscount(body.discountCode)
    const total = cart.total()
    return { status: 200, body: { totalCents: total, total: formatCurrency(total) } }
  })

  return async function handle(req) {
    const url = new URL(req.url, 'http://localhost')
    const match = router.match(req.method, url.pathname)
    if (!match) return { status: 404, body: { error: 'Not found' } }
    try {
      return await match.handler({ params: match.params, query: url.searchParams, body: req.body ?? {} })
    } catch (err) {
      return { status: 500, body: { error: err.message } }
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch (err) {
        reject(err)
      }
    })
  })
}

export function startServer(port = Number(process.env.PORT ?? 3000)) {
  const handle = createApp()
  const server = http.createServer(async (req, res) => {
    let body = {}
    try {
      body = await readJson(req)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Invalid JSON' }))
    }
    const out = await handle({ method: req.method, url: req.url, body })
    res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) })
    res.end(JSON.stringify(out.body))
  })
  return server.listen(port)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000)
  startServer(port)
  console.log(`Bookstore API listening on http://localhost:${port}`)
}
