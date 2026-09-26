/**
 * Shopping cart with discount codes and tax.
 */

export const DISCOUNT_CODES = {
  WELCOME10: { type: 'percent', value: 10 },
  SAVE5: { type: 'fixed', value: 500 },
}

export const TAX_RATE = 0.08

export class Cart {
  /** @param {import('./inventory.js').Inventory} inventory */
  constructor(inventory) {
    this.inventory = inventory
    this.items = new Map()
    this.discountCode = null
  }

  addItem(bookId, quantity = 1) {
    const book = this.inventory.find(bookId)
    if (!book) throw new Error(`Unknown book: ${bookId}`)
    const current = this.items.get(bookId) ?? 0
    this.items.set(bookId, current + quantity)
    return this
  }

  removeItem(bookId) {
    this.items.delete(bookId)
    return this
  }

  applyDiscount(code) {
    if (!DISCOUNT_CODES[code]) throw new Error(`Invalid discount code: ${code}`)
    this.discountCode = code
    return this
  }

  subtotal() {
    let sum = 0
    for (const [id, qty] of this.items) sum += this.inventory.find(id).priceCents * qty
    return sum
  }

  /**
   * Total in cents: subtotal, minus discount, plus tax on the discounted amount.
   */
  total() {
    const subtotal = this.subtotal()
    const taxed = Math.round(subtotal * (1 + TAX_RATE))
    const discount = this.discountCode ? DISCOUNT_CODES[this.discountCode] : null
    if (!discount) return taxed
    if (discount.type === 'percent') return Math.round(taxed * (1 - discount.value / 100))
    return Math.max(0, taxed - discount.value)
  }

  /** Remove purchased quantities from the inventory and empty the cart. */
  checkout() {
    const total = this.total()
    for (const [id, qty] of this.items) this.inventory.remove(id, qty)
    const receipt = { items: Object.fromEntries(this.items), totalCents: total }
    this.items.clear()
    this.discountCode = null
    return receipt
  }
}
