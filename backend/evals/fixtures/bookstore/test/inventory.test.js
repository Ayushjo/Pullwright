import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Inventory } from '../src/inventory.js'

const sample = () =>
  new Inventory([
    { id: 'a', title: 'Alpha', author: 'Ann', priceCents: 1000, stock: 2 },
    { id: 'b', title: 'Beta', author: 'Bob', priceCents: 500, stock: 0 },
  ])

test('find and list', () => {
  const inv = sample()
  assert.equal(inv.list().length, 2)
  assert.equal(inv.find('a').title, 'Alpha')
  assert.equal(inv.find('zzz'), null)
})

test('add creates or increments', () => {
  const inv = sample()
  inv.add({ id: 'a' }, 3)
  assert.equal(inv.find('a').stock, 5)
  inv.add({ id: 'c', title: 'Gamma', author: 'Cy', priceCents: 100 }, 1)
  assert.equal(inv.find('c').stock, 1)
  assert.throws(() => inv.add({ id: 'a' }, 0), RangeError)
})

test('remove and totalValue', () => {
  const inv = sample()
  inv.remove('a', 1)
  assert.equal(inv.find('a').stock, 1)
  assert.equal(inv.totalValue(), 1000)
})

test('loads the bundled catalogue', () => {
  const inv = Inventory.fromFile()
  assert.ok(inv.list().length >= 8)
})
