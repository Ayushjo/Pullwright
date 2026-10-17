/** Coarse device / browser / OS from a User-Agent, and bot detection. No library, no fingerprinting. */
export type UaInfo = { device: "mobile" | "tablet" | "desktop"; browser: string; os: string; bot: boolean }

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|whatsapp|telegrambot|discordbot|slackbot|twitterbot|linkedinbot|preview|headless|lighthouse|pagespeed|gtmetrix|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http-client|postman/i

export function parseUa(ua: string | undefined | null): UaInfo {
  const s = ua ?? ""
  const bot = !s || BOT.test(s)
  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(s)
  const mobile = !tablet && /mobi|iphone|ipod|android.*mobile|windows phone/i.test(s)
  const browser = /edg\//i.test(s)
    ? "Edge"
    : /opr\/|opera/i.test(s)
      ? "Opera"
      : /firefox|fxios/i.test(s)
        ? "Firefox"
        : /chrome|crios|chromium/i.test(s)
          ? "Chrome"
          : /safari/i.test(s)
            ? "Safari"
            : "Other"
  const os = /windows/i.test(s) ? "Windows" : /iphone|ipad|ipod/i.test(s) ? "iOS" : /mac os x|macintosh/i.test(s) ? "macOS" : /android/i.test(s) ? "Android" : /linux/i.test(s) ? "Linux" : "Other"
  return { device: tablet ? "tablet" : mobile ? "mobile" : "desktop", browser, os, bot }
}
