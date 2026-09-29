import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import { isIP } from "node:net"
import { Agent, fetch as undiciFetch } from "undici"

/**
 * Guard for user-supplied model endpoints (custom OpenAI-compatible URLs). The worker calls a URL
 * the user chose, so it must never reach private networks, localhost or cloud metadata services.
 * The check runs inside the connection's DNS lookup, so a hostname that re-resolves to a private
 * address between check and connect (DNS rebinding) is still refused.
 */

export class UnsafeEndpointError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeEndpointError"
  }
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
}
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
]

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const n = v4ToInt(ip)
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)))
  }
  if (v === 6) {
    const a = ip.toLowerCase()
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1]!)
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a)
  }
  return true // not an IP at all: refuse
}

/** Static checks on the URL itself (scheme, obvious internal names, literal private IPs). */
export function assertSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeEndpointError("Not a valid URL")
  }
  if (url.protocol !== "https:") throw new UnsafeEndpointError("Endpoint must use https://")
  if (url.username || url.password) throw new UnsafeEndpointError("Credentials in the URL are not allowed")
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeEndpointError("Internal hostnames are not allowed")
  }
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeEndpointError("Private, loopback and metadata addresses are not allowed")
  return url
}

/** DNS lookup that refuses private results — used for every connection to a custom endpoint. */
export function safeLookup(
  hostname: string,
  options: object,
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "", 0)
    const list = addresses as LookupAddress[]
    const bad = list.find((a) => isPrivateAddress(a.address))
    if (bad || !list.length) return cb(new UnsafeEndpointError(`${hostname} resolves to a private address`) as NodeJS.ErrnoException, "", 0)
    const all = (options as { all?: boolean }).all
    if (all) return cb(null, list)
    cb(null, list[0]!.address, list[0]!.family)
  })
}

const agent = new Agent({ connect: { lookup: safeLookup as never }, connectTimeout: 10_000, maxRedirections: 0 } as never)

/** fetch for custom endpoints: private addresses refused at connect time, no redirects, 10 MB cap on errors upstream. */
export const safeFetch = ((input: string | URL, init?: RequestInit) => {
  assertSafeUrl(typeof input === "string" ? input : input.toString())
  return undiciFetch(input as string, { ...(init as object), dispatcher: agent, redirect: "error" } as never)
}) as unknown as typeof fetch

/**
 * Same guard, but a 3xx comes back to the caller (redirect: "manual") so it can check every hop itself,
 * e.g. against a host allowlist. Never follows a redirect on its own.
 */
export const safeFetchManual = ((input: string | URL, init?: RequestInit) => {
  assertSafeUrl(typeof input === "string" ? input : input.toString())
  return undiciFetch(input as string, { ...(init as object), dispatcher: agent, redirect: "manual" } as never)
}) as unknown as typeof fetch
