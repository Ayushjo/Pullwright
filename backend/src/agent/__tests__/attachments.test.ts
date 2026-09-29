import { describe, it, expect } from "vitest"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { allowedUrl, downloadAttachments, extractAttachments, fetchAllowed, sniff } from "../intake/attachments.js"

const ID1 = "3a38776d-6b2f-4c9b-9d00-20c8618e8279"
const ID2 = "11111111-2222-4333-8444-555555555555"

describe("extractAttachments", () => {
  it("finds markdown images, <img> tags, bare asset links and file links, with context", () => {
    const md = [
      "The cart total is wrong after applying a code.",
      `![cart](https://github.com/user-attachments/assets/${ID1})`,
      `Also the header: <img width="400" alt="header" src="https://github.com/user-attachments/assets/${ID2}" />`,
      "Recording:",
      `https://github.com/user-attachments/assets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
      "[server.log](https://github.com/user-attachments/files/123/server.log)",
    ].join("\n")
    const refs = extractAttachments(md, undefined, "issue")
    expect(refs.map((r) => [r.n, r.kind, r.alt])).toEqual([
      [1, "image", "cart"],
      [2, "image", "header"],
      [3, "unknown", ""],
      [4, "file", "server.log"],
    ])
    expect(refs[0]!.context).toBe("The cart total is wrong after applying a code.")
    expect(refs[1]!.context).toContain("Also the header:")
  })

  it("pairs each image with body_html's signed URL by asset id, external images by order (camo)", () => {
    const md = `![a](https://github.com/user-attachments/assets/${ID1})\n![ext](https://i.imgur.com/x.png)\n![b](https://github.com/user-attachments/assets/${ID2})`
    const html = [
      `<p><a href="x"><img src="https://private-user-images.githubusercontent.com/1/2-${ID2}.png?jwt=BBB&amp;x=1" alt="b"></a></p>`,
      `<img src="https://camo.githubusercontent.com/abc/def" data-canonical-src="https://i.imgur.com/x.png">`,
      `<img src="https://private-user-images.githubusercontent.com/1/2-${ID1}.png?jwt=AAA" alt="a">`,
    ].join("")
    const refs = extractAttachments(md, html, "issue")
    expect(refs[0]!.fetchUrl).toContain(`${ID1}.png?jwt=AAA`)
    expect(refs[1]!.fetchUrl).toBe("https://camo.githubusercontent.com/abc/def")
    expect(refs[2]!.fetchUrl).toBe(`https://private-user-images.githubusercontent.com/1/2-${ID2}.png?jwt=BBB&x=1`)
  })

  it("numbers attachments across issue and comments", () => {
    const refs = extractAttachments(`![x](https://github.com/user-attachments/assets/${ID1})`, undefined, "comment 2", 5)
    expect(refs[0]!.n).toBe(5)
    expect(refs[0]!.where).toBe("comment 2")
  })
})

describe("allowedUrl", () => {
  it("allows only GitHub content hosts over https", () => {
    expect(allowedUrl(`https://github.com/user-attachments/assets/${ID1}`)).not.toBeNull()
    expect(allowedUrl("https://private-user-images.githubusercontent.com/1/2.png?jwt=x")).not.toBeNull()
    expect(allowedUrl("https://github-production-user-asset-6210df.s3.amazonaws.com/1/2.png")).not.toBeNull()
    expect(allowedUrl("https://camo.githubusercontent.com/a/b")).not.toBeNull()
    expect(allowedUrl("https://github.com/owner/repo/settings")).toBeNull()
    expect(allowedUrl("https://i.imgur.com/x.png")).toBeNull()
    expect(allowedUrl("http://user-images.githubusercontent.com/a.png")).toBeNull()
    expect(allowedUrl("https://evil.s3.amazonaws.com/a.png")).toBeNull()
  })
})

describe("sniff", () => {
  it("recognises images and videos by their bytes", () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png")
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg")
    expect(sniff(Buffer.from("GIF89a....", "latin1"))?.mime).toBe("image/gif")
    expect(sniff(Buffer.from("\0\0\0\x18ftypmp42", "latin1"))?.kind).toBe("video")
    expect(sniff(Buffer.from("hello"))).toBeNull()
  })
})

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)])
const fakeFetch = (routes: Record<string, () => Response>) =>
  (async (url: string) => {
    const r = routes[url]
    if (!r) throw new Error(`unexpected fetch ${url}`)
    return r()
  }) as unknown as typeof fetch

describe("fetchAllowed", () => {
  it("follows a redirect to GitHub's S3 bucket", async () => {
    const f = fakeFetch({
      [`https://github.com/user-attachments/assets/${ID1}`]: () => new Response(null, { status: 302, headers: { location: "https://github-production-user-asset-6210df.s3.amazonaws.com/1/a.png?X-Amz-Signature=s" } }),
      "https://github-production-user-asset-6210df.s3.amazonaws.com/1/a.png?X-Amz-Signature=s": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
    })
    const got = await fetchAllowed(`https://github.com/user-attachments/assets/${ID1}`, 1_000_000, f)
    expect("bytes" in got && got.bytes.length).toBe(PNG.length)
  })

  it("refuses a redirect off the allowlist, videos and oversized bodies", async () => {
    const f = fakeFetch({
      [`https://github.com/user-attachments/assets/${ID1}`]: () => new Response(null, { status: 302, headers: { location: "https://attacker.example/steal" } }),
      [`https://github.com/user-attachments/assets/${ID2}`]: () => new Response("x", { headers: { "content-type": "video/mp4" } }),
      "https://camo.githubusercontent.com/big": () => new Response(Buffer.alloc(5000), { headers: { "content-type": "image/png" } }),
    })
    expect(await fetchAllowed(`https://github.com/user-attachments/assets/${ID1}`, 1000, f)).toEqual({ skipped: "host not allowed (attacker.example)" })
    expect(await fetchAllowed(`https://github.com/user-attachments/assets/${ID2}`, 1000, f)).toEqual({ skipped: "video (not analysed)" })
    expect(await fetchAllowed("https://camo.githubusercontent.com/big", 1000, f)).toMatchObject({ skipped: expect.stringMatching(/too large/) })
  })
})

describe("downloadAttachments", () => {
  it("stores images outside the repo, dedupes, and skips what it can't use", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "att-"))
    const f = fakeFetch({
      "https://camo.githubusercontent.com/one": () => new Response(PNG),
      "https://camo.githubusercontent.com/two": () => new Response(PNG),
    })
    const refs = [
      { n: 1, where: "issue", kind: "image" as const, url: "u1", fetchUrl: "https://camo.githubusercontent.com/one", alt: "", context: "" },
      { n: 2, where: "issue", kind: "image" as const, url: "u2", fetchUrl: "https://camo.githubusercontent.com/two", alt: "", context: "" },
      { n: 3, where: "issue", kind: "image" as const, url: "u3", fetchUrl: "https://i.imgur.com/x.png", alt: "", context: "" },
    ]
    const out = await downloadAttachments(refs, dir, { fetchImpl: f })
    expect(out[0]!.file?.startsWith(dir)).toBe(true)
    expect(out[0]!.mime).toBe("image/png")
    expect(out[1]!.skipped).toBe("duplicate of an earlier attachment")
    expect(out[2]!.skipped).toMatch(/host not allowed/)
  })

  it("reads eval fixtures via attachment://name (basename only)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "att-"))
    const refs = [
      { n: 1, where: "issue", kind: "image" as const, url: "attachment://cart-nan.png", fetchUrl: "attachment://cart-nan.png", alt: "", context: "" },
      { n: 2, where: "issue", kind: "image" as const, url: "attachment://../../.env", fetchUrl: "attachment://../../.env", alt: "", context: "" },
    ]
    const out = await downloadAttachments(refs, dir, { local: true })
    expect(out[0]!.mime).toBe("image/png")
    expect(out[1]!.skipped).toBe("invalid local attachment name")
  })
})
