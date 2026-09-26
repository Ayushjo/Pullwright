import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCurrency, slugify, formatDate, padRight } from '../src/format.js'

test('formatCurrency', () => {
  assert.equal(formatCurrency(1999), '$19.99')
  assert.equal(formatCurrency(5), '$0.05')
  assert.equal(formatCurrency(-250, 'EUR'), '-€2.50')
})

test('slugify basic titles', () => {
  assert.equal(slugify('The Pragmatic Programmer'), 'the-pragmatic-programmer')
  assert.equal(slugify('Clean Code'), 'clean-code')
})

test('formatDate', () => {
  assert.equal(formatDate('2017-03-16T10:00:00Z'), '2017-03-16')
  assert.throws(() => formatDate('nope'), TypeError)
})

test('padRight', () => {
  assert.equal(padRight('ab', 4), 'ab  ')
  assert.equal(padRight('abcdef', 3), 'abc')
})
