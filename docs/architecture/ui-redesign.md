# UI redesign: devin.ai layout, Pullwright identity

October 2026. The owner liked our font (Plus Jakarta Sans) and blue, and wanted devin.ai's presentation. I studied devin.ai's home, product menu, pricing, customers, cloud and blog pages at 1024 px and 375 px, and measured the computed CSS. Then I applied the same structure to every Pullwright page. Behaviour is unchanged; only the presentation changed (plus the bugs listed at the end).

## What we took from devin.ai

- **Canvas:** an off-white canvas (`#f7f7f6`) with white cards. On marketing pages, a framed 1400 px column with hairline side borders and section dividers (`rgba(0,0,0,.06)`).
- **Headings:** large and regular weight (no bold), with tight tracking.
- **Two-tone headlines.** devin.ai pairs a grey lead-in with a black line. We tried that and a grey/blue version; the owner chose **black lead-in + blue statement line**. Tags `ui-black-accents`, `ui-blue-accents` and `ui-black-blue` (current) hold the three versions.
- **Labels and buttons:** small uppercase mono labels (JetBrains Mono) for section tags, column headers, dates and counts. Pill buttons: blue solid, plus an outline.
- **Product-as-hero:** every feature is shown with a replica of our real screens (`components/site/home/Mocks.tsx`), never generic icons.
- **Section patterns:** two plus three feature cards, numbered 01–04 steps in a zig-zag, a hairline icon grid, "Recently shipped", a closing call to action and a sparse footer. Pricing uses flat columns plus a comparison table.

What we did **not** take: customer logos, testimonials, security certifications (we have none), their licensed font, or their copy.

## Building blocks

| File | What |
|---|---|
| `index.css`, `tailwind.config.js` | Tokens: canvas, hairline, faint, code background; `background`/`foreground`/`primary` as rgb channels so opacity modifiers work; `max-w-frame`; `text-display`/`title`/`lead`; `rounded-pill` |
| `lib/cn.ts` | tailwind-merge taught the custom font sizes (it treated `text-title` as a colour) |
| `components/site/Layout.tsx` | `Frame`, `Section` |
| `components/site/Typography.tsx` | `TwoToneHeading` (`strongFirst`), `MonoLabel`, `ArrowLink` |
| `components/site/ProductShot.tsx` | Backdrop gradients and a `Window` frame for mocks |
| `components/site/Blocks.tsx` | `FeatureCard` (subgrid rows so titles align), `StepRow`, `IconGrid`, `ChangelogList` |
| `components/site/SiteNav.tsx`, `SiteFooter.tsx` | Marketing chrome: Product mega-menu and mobile sheet |
| `components/ui/PageHeader.tsx`, `EmptyState.tsx` | App page title and empty lists |
| `components/ui/Button.tsx` | `shape="pill"`, a `solid` variant and a true `outline` |
| `content/site.ts`, `plans.ts`, `changelog.ts` | Links, plan numbers (mirroring `limitsFor` and the queue rule), and real milestones |

## Pages

- **Home:** mono tag + two-tone hero, pill issue form, task-view shot with a floating PR card. Then models strip, features, steps, demo, keys grid, recently shipped, safety, closing call to action and footer.
- **Pricing:** two-tone header, three plan columns (subgrid, so buttons and lists line up), a comparison table with a sticky first column on phones, providers strip, hairline FAQ.
- **Login (= sign-up):** "Welcome to Pullwright", GitHub pill, what we ask GitHub for, product shot.
- **Replay:** site chrome, pill play/speed controls, closing call to action.
- **App:** slim blurred nav. Dashboard stats as one hairline grid, underline tabs, flat task cards. History rows, New task, the task view (header, sidebar, plan card, feed, diff, review, composer), Settings and Keys all moved to the same tokens.

Status colours now carry one meaning each: **blue** = you need to act, **neutral + pulsing dot** = working, **amber** = paused or needs review, **green** = done, **red** = failed.

## Checks

Every page was checked at 1280 px and at 375 px. A script flags any element extending past the viewport's right edge; it reports none on Home, Pricing, Login, Replay, Dashboard, History, New task, Keys, Settings and two task views. Interactions were exercised in the browser: menu hover and close, mobile sheet and anchor scroll, FAQ, plan-switch checkout, Login `returnTo`, task tabs, history expand. Typecheck and lint are clean.

## Bugs found on the way (fixed)

- Opacity modifiers on `foreground` and `background` rendered nothing (16 grey tints showed as black).
- The mobile menu had no height: the header's `backdrop-filter` trapped the `position: fixed` sheet.
- The hero URL field collapsed to 26 px on phones (`flex-1` in a column).
- Feature-card mocks were clipped by fixed aspect ratios.
- Pricing buttons sat at different heights.
- **Login ignored `?returnTo=`**, so sign-ins from Pricing/Keys landed on Home.
- History's "Done" filter missed tasks that opened a PR, and Paused and Ready had no tab.
- The task elapsed time showed as "1002:49".
- TaskCard showed two status dots on live tasks.
- Hard-coded hex colours on Dashboard, TaskCard and Login were replaced by tokens.
