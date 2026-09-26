import { readFileSync } from 'node:fs'

/**
 * In-memory book inventory.
 */
export class Inventory {
  /** @param {Array<{id:string,title:string,author:string,priceCents:number,stock:number,tags?:string[],published?:string}>} books */
  constructor(books = []) {
    this.books = new Map()
    for (const b of books) this.books.set(b.id, { tags: [], ...b })
  }

  static fromFile(path = new URL('./data/books.json', import.meta.url)) {
    return new Inventory(JSON.parse(readFileSync(path, 'utf8')))
  }

  list() {
    return [...this.books.values()]
  }

  find(id) {
    return this.books.get(id) ?? null
  }

  /** Add stock for a book (creates it when missing). */
  add(book, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError('quantity must be a positive integer')
    const existing = this.books.get(book.id)
    if (existing) {
      existing.stock += quantity
      return existing
    }
    const created = { tags: [], ...book, stock: quantity }
    this.books.set(book.id, created)
    return created
  }

  /** Remove stock for a book. */
  remove(id, quantity = 1) {
    const book = this.books.get(id)
    if (!book) throw new Error(`Unknown book: ${id}`)
    book.stock -= quantity
    return book
  }

  /** Total value of all stock in cents. */
  totalValue() {
    let total = 0
    for (const b of this.books.values()) total += b.priceCents * b.stock
    return total
  }

  search(query) {
    const q = String(query).toLowerCase()
    return this.list().filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
  }
}
