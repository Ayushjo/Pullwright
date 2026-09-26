import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Inventory } from '../src/inventory.js'
import { summary, render, median, percentile, byTag, toCsv, csvCell } from '../src/report.js'

const books = () => Inventory.fromFile().list()

test('stats helpers', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9)
  assert.throws(() => percentile([1], 120), RangeError)
})

test('summary totals', () => {
  const s = summary(books(), { generatedAt: '2026-01-01' })
  assert.equal(s.titles, 8)
  assert.equal(s.units, 38)
  assert.equal(s.generatedAt, '2026-01-01')
  assert.deepEqual(s.outOfStock.map((b) => b.id), ['b4'])
})

test('byTag counts multi-tag books under each tag', () => {
  const craft = byTag(books()).find((t) => t.tag === 'craft')
  assert.equal(craft.titles, 4)
})

test('renderers', () => {
  const text = render(books(), 'text', { generatedAt: '2026-01-01' })
  assert.match(text, /INVENTORY REPORT — 2026-01-01/)
  assert.match(text, /Out of stock: Designing Data-Intensive Applications/)
  const md = render(books(), 'markdown', { generatedAt: '2026-01-01' })
  assert.match(md, /^# Inventory report \(2026-01-01\)/)
  assert.match(md, /## By decade/)
  assert.throws(() => render(books(), 'pdf'), /Unknown report format/)
})

test('csv', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  const csv = toCsv(books())
  assert.equal(csv.trim().split('\n').length, 9)
})
