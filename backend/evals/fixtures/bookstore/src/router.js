/**
 * Minimal router for node:http — supports path params like /books/:id.
 */
export class Router {
  constructor() {
    this.routes = []
  }

  add(method, pattern, handler) {
    const keys = []
    const regex = new RegExp(
      '^' +
        pattern.replace(/\/:([a-zA-Z_]+)/g, (_, key) => {
          keys.push(key)
          return '/([^/]+)'
        }) +
        '/?$',
    )
    this.routes.push({ method, regex, keys, handler })
    return this
  }

  get(pattern, handler) {
    return this.add('GET', pattern, handler)
  }

  post(pattern, handler) {
    return this.add('POST', pattern, handler)
  }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = pathname.match(r.regex)
      if (!m) continue
      const params = {}
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      return { handler: r.handler, params }
    }
    return null
  }
}
