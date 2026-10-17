# SEO and first-party analytics (10-17)

## SEO

**What crawlers and link previews get now**

| | Before | Now |
|---|---|---|
| HTML of public pages | an empty `<div id="root">` (client-rendered) | **prerendered at build**: `/` (1,142 words), `/pricing` (492), `/login` (184), with no hidden text (reduced motion plus a scroll pass, so every reveal-on-scroll finishes) |
| Titles / descriptions | one static pair | per page (`src/lib/seo.ts` `useSeo`) |
| Canonical, Open Graph, Twitter card | none | per page; 1200×630 share image (`public/og.png`) built from the real brand mark |
| Structured data | none | SoftwareApplication with Free/Pro offers, Organization, WebSite (Home); FAQPage from the real FAQ (Pricing) |
| App pages | indexable | `noindex, nofollow`; also disallowed in `robots.txt` |
| robots.txt / sitemap.xml / manifest | none | `public/robots.txt`, `public/sitemap.xml` (/, /pricing, /login), `public/site.webmanifest` |
| Icons | the touch icon showed a cropped "Pullwri" | rebuilt from the SVG mark: `icon.svg` (also the SVG favicon), `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` |
| Headings | two-tone headings read "PullwrightPlans and pricing" | a real space between the two lines |

**Build and serve**
- `npm run build` = `tsc -b && vite build && node scripts/prerender.mjs`.
  - The prerender serves `dist/` with `vite preview`, opens each public route in headless Chromium (reduced motion, full scroll) and writes `dist/<route>/index.html`.
  - The untouched SPA shell is kept as `dist/app.html`.
  - It skips cleanly (exit 0) without Playwright or a browser, or with `PRERENDER=0`. `PW_CHROMIUM` points it at a specific browser binary.
- **Routing rules:** a real file → that file; a prerendered route → its page; anything else → `app.html`, so app routes never receive Home's content or canonical.
  - `npm start` is now `node scripts/serve.mjs dist`, a small explicit static server: hashed assets get a year of immutable cache, HTML `no-cache`, and path traversal falls back to the shell. `serve -s` rewrote every route to `index.html`, which defeated prerendering.
  - Cloudflare Pages: `public/_redirects` has the same rules.
- `MotionConfig reducedMotion="user"`: the OS "reduce motion" setting is respected everywhere (an accessibility fix in its own right).
- Canonical base: `VITE_SITE_URL`, default `https://pullwright.iayush.com` (from the OAuth app's homepage).

**Next for SEO, not done**
- Content pages that can rank: docs, "how it works", comparisons, the changelog as pages.
- `/r/:id` replay pages in the sitemap once real public replays exist.
- Submit the sitemap in Google Search Console and Bing Webmaster Tools after deploy.
- A Lighthouse pass on the deployed site.

## First-party analytics

Cloudflare's analytics see requests. These see the product journey, in our own Postgres.

**Schema** (migration `20261017000000_analytics_events`, additive; applied to Neon with `prisma migrate deploy` on 10-17, and every existing row count was identical before and after):
- `analytics_events`: `name`, `source` (client or server), `user_id`, `anon_id`, `session_id`, `path`, `referrer`, `utm_*`, `country`, `device`, `browser`, `os`, `props` (JSONB), `ts`. Indexed by time, (name, time), (user, time) and (visitor, time).
- `users.first_touch` (JSONB) and `users.last_seen_at`.

**Browser** (`src/lib/analytics.ts`): no third-party scripts and no cookies of its own.
- A random visitor id in localStorage; a session id that rotates after 30 min idle.
- Each page load's attribution (UTM tags, external referrer), recorded even mid-session.
- `page_view` on every route change, `cta_click` for any element with `data-track` (props from `data-track-*`), and `outbound_click`.
- `identify` once per account per browser after sign-in, marked done only after the server confirms.
- Batched `fetch` with `keepalive` and credentials (works cross-origin in production).
- Tagged CTAs: nav Start free / Login, hero submit (desktop and mobile), Watch a replay, Home and Replay footer Start free, GitHub sign-in, Pricing plan CTAs (per plan), Upgrade to Pro, Buy credit pack.

**Collect** (`POST /api/t`, `api/analyticsRouter.ts`):
- allowlisted event names only, and at most 20 per batch;
- props capped at 2 KB;
- rate-limited per IP; always answers 204;
- the user comes from the session cookie, never the body;
- query strings and same-site referrers are stripped;
- bots are dropped;
- anonymous visitors with **Do Not Track or Global Privacy Control** are not tracked (Brave sends GPC by default). Signed-in product events are still recorded.

**Server events** (`analytics/track.ts`), batched and never able to fail a request:

| Event | Fires on |
|---|---|
| `signup` / `login` | the OAuth callback (new vs returning account) |
| `task_created` | a task starts (with `keyKind`, `fundedBy`, `queueClass`, `tier`, consent) |
| `plan_ready`, `asked_user`, `task_parked`, `task_finished` (status, cost, calls), `pr_published` | the task's status changes (once per task and status) |
| `limit_hit` | any 402/429 on the task route, with its code |
| `key_added` / `key_rejected` / `key_removed` | the wallet |
| `checkout_started`, `trial_claimed` / `trial_refused`, `purchase` | billing |
| `subscription_<status>` | a real change of subscription state |

**`identify`** attaches the browser's anonymous events to the account and sets `first_touch` from the earliest anonymous page view: landing page, referrer, UTM tags, country, device. `last_seen_at` updates at most every 10 min per user.

**Owner dashboard** (`/admin/analytics`, **Analytics** in the owner nav; `GET /api/admin/analytics?days=7|30|90`):
- KPIs: visitors, signups (with % of visitors), active users, tasks (and PRs published), purchases.
- **Daily visitors, signups and tasks as three small charts** (one measure per axis), with hover.
- **Activation funnel**: visited → signed up → started a task → got a result → published a PR → paid, with step conversion.
- Sources: a session's UTM source or referrer host, with how many of those visitors then signed in.
- Top pages, devices, countries, and refusal codes.
- Recent signups, with where each first came from, tasks and last seen.

**Tests:** `analytics.test.ts` (5) runs the real router on a port:
- allowed events recorded with server context;
- query strings and same-site referrers stripped;
- unknown names ignored;
- bots, DNT and GPC dropped;
- the user taken from the session and never the body, with identify linking the visitor;
- malformed batches → 204, nothing recorded.

UA parsing is tested too.

**Live check (Brave, 10-17):**
- page views on `/`, `/pricing` and `/wallet`;
- the plan-CTA click (`plan_cta`, plan `free`);
- a UTM link recorded (`utm_source=test`, `utm_campaign=analytics-check`);
- identify linking the visitor and setting `first_touch`;
- the dashboard rendering it all.

Country is empty locally because the `CF-IPCountry` header only exists behind Cloudflare.

## Open

- **A privacy page:** a real one is needed at launch. It should say what's tracked (the above), why, the retention period, and how to opt out (DNT/GPC). It's not written yet because it's legal text you should approve.
- **Retention:** decide how long raw events are kept (e.g. 13 months), then add a nightly delete.
- Cloudflare in front of both the site and the API, so countries are filled in.
