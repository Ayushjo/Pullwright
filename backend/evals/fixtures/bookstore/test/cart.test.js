import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Inventory } from '../src/inventory.js'
import { Cart } from '../src/cart.js'

const inv = () => new Inventory([{ id: 'a', title: 'Alpha', author: 'Ann', priceCents: 10000, stock: 5 }])

test('subtotal and total with tax', () => {
  const cart = new Cart(inv()).addItem('a', 2)
  assert.equal(cart.subtotal(), 20000)
  assert.equal(cart.total(), 21600)
})

test('percent discount', () => {
  const cart = new Cart(inv()).addItem('a', 1).applyDiscount('WELCOME10')
  assert.equal(cart.total(), 9720)
})

test('checkout decrements stock', () => {
  const i = inv()
  const receipt = new Cart(i).addItem('a', 2).checkout()
  assert.equal(receipt.totalCents, 21600)
  assert.equal(i.find('a').stock, 3)
})
