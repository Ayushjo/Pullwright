/**
 * Inventory reporting.
 *
 * Builds summary statistics over the inventory and renders them as plain text,
 * Markdown or CSV. Everything here is pure: functions take an array of books and
 * return data or strings, which keeps the module easy to test.
 */
import { formatCurrency, formatDate, padRight } from './format.js'

// ─────────────────────────────────────────────────────────────────────────────
// Basic statistics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum of a numeric field across items.
 * @param {object[]} items
 * @param {(item: object) => number} pick
 */
export function sumBy(items, pick) {
  let total = 0
  for (const item of items) total += pick(item)
  return total
}

/**
 * Arithmetic mean; 0 for an empty list.
 * @param {number[]} values
 */
export function mean(values) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Median of a list of numbers; 0 for an empty list.
 * @param {number[]} values
 */
export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Nearest-rank percentile (p in 0..100).
 * @param {number[]} values
 * @param {number} p
 */
export function percentile(values, p) {
  if (values.length === 0) return 0
  if (p < 0 || p > 100) throw new RangeError('p must be between 0 and 100')
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

/**
 * Smallest and largest value.
 * @param {number[]} values
 */
export function range(values) {
  if (values.length === 0) return { min: 0, max: 0 }
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

/**
 * Standard deviation (population).
 * @param {number[]} values
 */
export function stddev(values) {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group items by a key.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {Map<string, T[]>}
 */
export function groupBy(items, keyOf) {
  const groups = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

/**
 * Books grouped by author, with totals.
 * @param {object[]} books
 */
export function byAuthor(books) {
  const out = []
  for (const [author, list] of groupBy(books, (b) => b.author)) {
    out.push({
      author,
      titles: list.length,
      units: sumBy(list, (b) => b.stock),
      valueCents: sumBy(list, (b) => b.priceCents * b.stock),
    })
  }
  return out.sort((a, b) => b.valueCents - a.valueCents || a.author.localeCompare(b.author))
}

/**
 * Books grouped by tag. A book with several tags is counted under each of them.
 * @param {object[]} books
 */
export function byTag(books) {
  const tagged = []
  for (const b of books) {
    const tags = b.tags && b.tags.length ? b.tags : ['untagged']
    for (const tag of tags) tagged.push({ ...b, tag })
  }
  const out = []
  for (const [tag, list] of groupBy(tagged, (b) => b.tag)) {
    out.push({
      tag,
      titles: list.length,
      units: sumBy(list, (b) => b.stock),
      avgPriceCents: Math.round(mean(list.map((b) => b.priceCents))),
    })
  }
  return out.sort((a, b) => b.titles - a.titles || a.tag.localeCompare(b.tag))
}

/**
 * Bucket books by publication decade, e.g. "1990s".
 * @param {object[]} books
 */
export function byDecade(books) {
  const out = []
  const groups = groupBy(
    books.filter((b) => b.published),
    (b) => `${Math.floor(new Date(b.published).getUTCFullYear() / 10) * 10}s`,
  )
  for (const [decade, list] of groups) {
    out.push({ decade, titles: list.length, units: sumBy(list, (b) => b.stock) })
  }
  return out.sort((a, b) => a.decade.localeCompare(b.decade))
}

// ─────────────────────────────────────────────────────────────────────────────
// Price statistics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Price statistics over all titles (not weighted by stock).
 * @param {object[]} books
 */
export function priceStats(books) {
  const prices = books.map((b) => b.priceCents)
  const { min, max } = range(prices)
  return {
    count: prices.length,
    minCents: min,
    maxCents: max,
    meanCents: Math.round(mean(prices)),
    medianCents: Math.round(median(prices)),
    p90Cents: percentile(prices, 90),
    stddevCents: Math.round(stddev(prices)),
  }
}

/**
 * The N most valuable titles by stock value.
 * @param {object[]} books
 * @param {number} n
 */
export function topByValue(books, n = 3) {
  return [...books]
    .map((b) => ({ id: b.id, title: b.title, valueCents: b.priceCents * b.stock }))
    .sort((a, b) => b.valueCents - a.valueCents || a.title.localeCompare(b.title))
    .slice(0, n)
}

/**
 * Titles that are completely out of stock.
 * @param {object[]} books
 */
export function outOfStock(books) {
  return books.filter((b) => b.stock === 0).map((b) => ({ id: b.id, title: b.title }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full summary used by every renderer.
 * @param {object[]} books
 * @param {{ generatedAt?: string | Date }} [options]
 */
export function summary(books, options = {}) {
  const generatedAt = options.generatedAt ?? new Date()
  return {
    generatedAt: formatDate(generatedAt),
    titles: books.length,
    units: sumBy(books, (b) => b.stock),
    valueCents: sumBy(books, (b) => b.priceCents * b.stock),
    prices: priceStats(books),
    authors: byAuthor(books),
    tags: byTag(books),
    decades: byDecade(books),
    top: topByValue(books, 3),
    outOfStock: outOfStock(books),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render rows as a fixed-width text table.
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export function textTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const line = (cells) => cells.map((c, i) => padRight(c, widths[i])).join('  ').trimEnd()
  const sep = widths.map((w) => '-'.repeat(w)).join('  ')
  return [line(headers), sep, ...rows.map(line)].join('\n')
}

/**
 * Plain-text report.
 * @param {ReturnType<typeof summary>} s
 */
export function renderText(s) {
  const parts = []
  parts.push(`INVENTORY REPORT — ${s.generatedAt}`)
  parts.push('')
  parts.push(`Titles: ${s.titles}   Units: ${s.units}   Stock value: ${formatCurrency(s.valueCents)}`)
  parts.push('')
  parts.push('Prices')
  parts.push(
    textTable(
      ['min', 'median', 'mean', 'p90', 'max'],
      [
        [
          formatCurrency(s.prices.minCents),
          formatCurrency(s.prices.medianCents),
          formatCurrency(s.prices.meanCents),
          formatCurrency(s.prices.p90Cents),
          formatCurrency(s.prices.maxCents),
        ],
      ],
    ),
  )
  parts.push('')
  parts.push('By author')
  parts.push(
    textTable(
      ['author', 'titles', 'units', 'value'],
      s.authors.map((a) => [a.author, String(a.titles), String(a.units), formatCurrency(a.valueCents)]),
    ),
  )
  parts.push('')
  parts.push('By tag')
  parts.push(
    textTable(
      ['tag', 'titles', 'units', 'avg price'],
      s.tags.map((t) => [t.tag, String(t.titles), String(t.units), formatCurrency(t.avgPriceCents)]),
    ),
  )
  parts.push('')
  parts.push('Top titles by stock value')
  parts.push(textTable(['title', 'value'], s.top.map((t) => [t.title, formatCurrency(t.valueCents)])))
  if (s.outOfStock.length) {
    parts.push('')
    parts.push(`Out of stock: ${s.outOfStock.map((b) => b.title).join(', ')}`)
  }
  return parts.join('\n') + '\n'
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape characters that break Markdown tables.
 * @param {string} text
 */
export function mdEscape(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/**
 * Render rows as a Markdown table.
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export function mdTable(headers, rows) {
  const head = `| ${headers.map(mdEscape).join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map(mdEscape).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

/**
 * Markdown report.
 * @param {ReturnType<typeof summary>} s
 */
export function renderMarkdown(s) {
  const parts = []
  parts.push(`# Inventory report (${s.generatedAt})`)
  parts.push('')
  parts.push(`- **Titles:** ${s.titles}`)
  parts.push(`- **Units:** ${s.units}`)
  parts.push(`- **Stock value:** ${formatCurrency(s.valueCents)}`)
  parts.push('')
  parts.push('## By author')
  parts.push('')
  parts.push(
    mdTable(
      ['Author', 'Titles', 'Units', 'Value'],
      s.authors.map((a) => [a.author, String(a.titles), String(a.units), formatCurrency(a.valueCents)]),
    ),
  )
  parts.push('')
  parts.push('## By tag')
  parts.push('')
  parts.push(
    mdTable(
      ['Tag', 'Titles', 'Units', 'Avg price'],
      s.tags.map((t) => [t.tag, String(t.titles), String(t.units), formatCurrency(t.avgPriceCents)]),
    ),
  )
  parts.push('')
  parts.push('## By decade')
  parts.push('')
  parts.push(mdTable(['Decade', 'Titles', 'Units'], s.decades.map((d) => [d.decade, String(d.titles), String(d.units)])))
  if (s.outOfStock.length) {
    parts.push('')
    parts.push('## Out of stock')
    parts.push('')
    for (const b of s.outOfStock) parts.push(`- ${b.title}`)
  }
  return parts.join('\n') + '\n'
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quote a CSV cell when needed (RFC 4180).
 * @param {unknown} value
 */
export function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * One row per book.
 * @param {object[]} books
 */
export function toCsv(books) {
  const headers = ['id', 'title', 'author', 'price', 'stock', 'value', 'tags']
  const rows = books.map((b) => [
    b.id,
    b.title,
    b.author,
    (b.priceCents / 100).toFixed(2),
    b.stock,
    ((b.priceCents * b.stock) / 100).toFixed(2),
    (b.tags ?? []).join(';'),
  ])
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

/**
 * Render a report in the requested format.
 * @param {object[]} books
 * @param {'text' | 'markdown' | 'csv'} format
 * @param {{ generatedAt?: string | Date }} [options]
 */
export function render(books, format = 'text', options = {}) {
  if (format === 'csv') return toCsv(books)
  const s = summary(books, options)
  if (format === 'markdown') return renderMarkdown(s)
  if (format === 'text') return renderText(s)
  throw new Error(`Unknown report format: ${format}`)
}
