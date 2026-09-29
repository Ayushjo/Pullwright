import { describe, it, expect } from "vitest"
import { assertSafeUrl, isPrivateAddress, safeLookup } from "../safeEndpoint.js"

describe("custom endpoint guard", () => {
  it("classifies private, loopback, link-local, CGNAT and metadata addresses", () => {
    for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "::1", "fd00:ec2::254", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ["8.8.8.8", "104.18.2.3", "2606:4700::6810:84e5"]) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it("rejects unsafe URLs before any network call", () => {
    expect(() => assertSafeUrl("http://api.example.com/v1")).toThrow(/https/)
    expect(() => assertSafeUrl("https://localhost:8080/v1")).toThrow(/Internal/)
    expect(() => assertSafeUrl("https://169.254.169.254/latest/meta-data")).toThrow(/Private/)
    expect(() => assertSafeUrl("https://[::1]/v1")).toThrow(/Private/)
    expect(() => assertSafeUrl("https://user:pw@api.example.com")).toThrow(/Credentials/)
    expect(assertSafeUrl("https://api.together.xyz/v1").hostname).toBe("api.together.xyz")
  })

  it("the connect-time lookup refuses names that resolve to private addresses", async () => {
    const err = await new Promise<Error | null>((resolve) => safeLookup("localhost", {}, (e) => resolve(e)))
    expect(err?.message).toMatch(/private address/)
  })
})
