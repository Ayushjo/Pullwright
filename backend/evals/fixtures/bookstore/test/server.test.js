import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/server.js'
import { Inventory } from '../src/inventory.js'

const app = () => createApp(Inventory.fromFile())

test('GET /health', async () => {
  const res = await app()({ method: 'GET', url: '/health' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

test('GET /books lists the catalogue', async () => {
  const res = await app()({ method: 'GET', url: '/books' })
  assert.equal(res.status, 200)
  assert.ok(res.body.length >= 8)
})

test('GET /books/:id', async () => {
  const ok = await app()({ method: 'GET', url: '/books/b2' })
  assert.equal(ok.body.title, 'Clean Code')
  const missing = await app()({ method: 'GET', url: '/books/nope' })
  assert.equal(missing.status, 404)
})

test('POST /cart/quote', async () => {
  const res = await app()({ method: 'POST', url: '/cart/quote', body: { items: [{ id: 'b6', quantity: 1 }] } })
  assert.equal(res.status, 200)
  assert.equal(res.body.totalCents, 3239)
})
