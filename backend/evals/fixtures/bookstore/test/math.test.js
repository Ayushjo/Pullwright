import { test } from 'node:test'
import assert from 'node:assert/strict'
import { divide, multiply, add } from '../src/math.js'

test('basic arithmetic', () => {
  assert.equal(divide(10, 2), 5)
  assert.equal(multiply(3, 4), 12)
  assert.equal(add(1, 2), 3)
})

test('divide by zero throws RangeError', () => {
  assert.throws(() => divide(10, 0), RangeError)
})
