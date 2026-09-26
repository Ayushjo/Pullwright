/**
 * Formatting helpers shared by the API and the reports.
 */

/**
 * Format an amount in cents as a currency string, e.g. 1999 -> "$19.99".
 * @param {number} cents
 * @param {string} [currency]
 */
export function formatCurrency(cents, currency = 'USD') {
  const symbols = { USD: '$', EUR: '€', GBP: '£', INR: '₹' }
  const symbol = symbols[currency] ?? `${currency} `
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const whole = Math.floor(abs / 100)
  const fraction = String(abs % 100).padStart(2, '0')
  return `${sign}${symbol}${whole}.${fraction}`
}

/**
 * Turn a title into a URL slug: "The Pragmatic Programmer" -> "the-pragmatic-programmer".
 * @param {string} text
 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

/**
 * Format an ISO date as YYYY-MM-DD.
 * @param {string | Date} value
 */
export function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) throw new TypeError(`Invalid date: ${value}`)
  return d.toISOString().slice(0, 10)
}

/**
 * Pad a string on the right to a fixed width (used by text reports).
 * @param {string} text
 * @param {number} width
 */
export function padRight(text, width) {
  const s = String(text)
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length)
}
