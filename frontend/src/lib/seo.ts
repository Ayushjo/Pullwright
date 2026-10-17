import { useEffect } from 'react'

/**
 * Per-page SEO: title, description, canonical, Open Graph / Twitter cards, robots, JSON-LD.
 * Public pages are also prerendered at build time (scripts/prerender.mjs), so crawlers and link
 * previews get these tags and the page content without running JavaScript.
 */
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://pullwright.iayush.com'
export const SITE_NAME = 'Pullwright'
const DEFAULT_IMAGE = `${SITE_URL}/og.png`

export type Seo = {
  title: string
  description: string
  /** Path for the canonical URL ("/pricing"); omit on pages that shouldn't have one. */
  path?: string
  image?: string
  /** App pages (dashboard, settings…) are not for search results. */
  noindex?: boolean
  /** Structured data for this page (one object or several). */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

function upsert(selector: string, create: () => HTMLElement, set: (el: HTMLElement) => void) {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  set(el)
}
const meta = (attr: 'name' | 'property', key: string, content: string) =>
  upsert(`meta[${attr}="${key}"]`, () => document.createElement('meta'), (el) => {
    el.setAttribute(attr, key)
    el.setAttribute('content', content)
  })

export function applySeo(s: Seo) {
  const title = s.title.includes(SITE_NAME) ? s.title : `${s.title} · ${SITE_NAME}`
  document.title = title
  meta('name', 'description', s.description)
  meta('name', 'robots', s.noindex ? 'noindex, nofollow' : 'index, follow')
  const url = s.path !== undefined ? `${SITE_URL}${s.path}` : null
  if (url) upsert('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), (el) => el.setAttribute('href', url))
  else document.head.querySelector('link[rel="canonical"]')?.remove()
  const image = s.image ?? DEFAULT_IMAGE
  meta('property', 'og:type', 'website')
  meta('property', 'og:site_name', SITE_NAME)
  meta('property', 'og:title', title)
  meta('property', 'og:description', s.description)
  meta('property', 'og:image', image)
  if (url) meta('property', 'og:url', url)
  meta('name', 'twitter:card', 'summary_large_image')
  meta('name', 'twitter:title', title)
  meta('name', 'twitter:description', s.description)
  meta('name', 'twitter:image', image)
  document.head.querySelectorAll('script[data-seo="page"]').forEach((n) => n.remove())
  for (const data of s.jsonLd ? (Array.isArray(s.jsonLd) ? s.jsonLd : [s.jsonLd]) : []) {
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.dataset.seo = 'page'
    el.textContent = JSON.stringify({ '@context': 'https://schema.org', ...data })
    document.head.appendChild(el)
  }
}

export function useSeo(s: Seo) {
  const key = JSON.stringify(s)
  useEffect(() => {
    applySeo(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** The product as a SoftwareApplication with its plans as offers (Home and Pricing). */
export const softwareJsonLd = {
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  description: 'Hand it a GitHub issue: Pullwright plans the change, edits and tests it in a sandbox, has it reviewed, and opens the pull request when you approve.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro', price: '8', priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', price: '8', priceCurrency: 'USD', billingDuration: 'P1M' } },
  ],
}
