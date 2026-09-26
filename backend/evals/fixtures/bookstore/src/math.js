/**
 * Basic math utilities.
 * BUG: divide() does not handle division by zero.
 *      It silently returns Infinity instead of throwing.
 */
export function divide(a, b) {
  return a / b
}

export function multiply(a, b) {
  return a * b
}

export function add(a, b) {
  return a + b
}
