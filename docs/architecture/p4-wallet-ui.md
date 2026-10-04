# P4 frontend: Wallet, capacity, pricing, private-repo consent

Status as of 2026-10-04. Backend for the wallet landed in `00c7a1f` (see `free-without-credit.md` and the plan). This page covers the screens built on top of it, how they were checked, and what the checks found.

## What was built

| Screen / piece | What it does |
|---|---|
| **Wallet** (`/wallet`, "Keys" in both navs) | Paste any key; the provider is named as you paste (same patterns as the backend). The key is checked with the provider without spending, then stored encrypted. A capability strip shows *Plan & write code / Review patches / Read screenshots*, with a plain sentence for what's missing ("Groq can review but can't plan… add a free Gemini key"). One card per provider: guided steps, a link to the key page, and once saved: tier (Free, Free credit, Paid · used last), "Public repos only" for keys that may train, Vercel credit left of $5, OpenRouter free requests left today, *Check again*, and *Remove* with a 5-second undo. A hand-drawn "start here" arrow sits on Gemini until tasks can run. |
| **Capacity meter** (New task, Dashboard, Settings) | "2 of 3 free tasks left today" with a dot per task. Explains when blocked: one task at a time on free, or the time the next slot frees up. Reads `GET /api/capacity`. |
| **Pricing** | Three ways to use it: free keys ($0), your paid keys (provider rates), Pro ($8/month, $3 model usage, 25 tasks/day, 3 at once, priority queue). Built as a selectable list whose details expand. The limits match `entitlements/admission.ts`. |
| **Private-repo consent** | `POST /task` answers **409 `private_repo_training`** when the repo is private and the wallet can only plan and code on keys that may train (Gemini free, OpenRouter free). New task then shows "Allow it for this task only" or "add a key that doesn't train". The task records `allowTraining`. The pipeline re-checks after fetching the issue, in case the up-front visibility lookup failed. The repo lookup costs one GitHub call and only runs when the wallet has no non-training planner. |
| **Settings** | The old OpenAI/OpenRouter key forms are replaced by a link to the Wallet. "Runs this month" is replaced by the daily meter (the monthly count never applied to wallet tasks). The hard-coded "$12/mo" is gone. |
| **Paused banner** | On phones the buttons stack under the text. The resume time names the day when it isn't today ("Mon 05:30"). "Adding another key" links to the Wallet. |
| **Home** | "Free to run with a free Google Gemini key — no card", with a link to pricing. |

Motion and doodles: hand-drawn SVG accents (`components/hand/Scribbles.tsx`: underline, arrow, loop, tick, key) draw themselves once using `pathLength`, and appear without motion under reduced-motion. Morphing button text, a status button and undo-delete are adapted from [useLayouts](https://uselayouts.com) (MIT): rewritten for `framer-motion` and `lucide-react`, with no new dependencies. Doodle labels use Caveat.

## How it was checked

All checks ran in the app's browser against the local backend, at 1280 px and 375 px (mobile emulation). Every page was checked for horizontal overflow by script (`scrollWidth` and any element past the viewport's right edge).

| Check | Result |
|---|---|
| Paste a fake `gsk_` key | Provider chip "Groq" → Checking → provider rejected it → red "Try again" and the server's message |
| Real Groq key saved | Free badge, masked key, review + screenshots ticked, the "add Gemini" nudge, start-here stays on Gemini |
| Remove → Undo within 5 s | No DELETE sent; key still listed |
| Remove, no undo | DELETE after 5 s; toast; card back to the "how to get one" state |
| Check again | `POST /wallet/keys/groq/check` → 200 |
| Gemini + Groq saved | All three capabilities; Gemini shows "Public repos only" |
| Signed in as a regular user (launch profile `pullwright-backend-asuser`), private repo issue | 409 → consent panel; Start disabled until ticked; **no admission slot used** (meter still 3 of 3) |
| Overflow at 375 px | Wallet, New task, Settings, Pricing, Dashboard, History, Home, task page: all fit after the fixes below |

## Bugs the checks found (all fixed)

1. **Opacity modifiers on theme colors silently did nothing.** `primary` was `var(--primary)`, and Tailwind can't apply `/10` to that, so every `bg-primary/10`, `border-primary/20` and `ring-primary/15` in the app (about 50 uses) rendered nothing unless index.css had a hand-written copy. `primary` is now `rgb(var(--primary-rgb) / <alpha-value>)`.
2. **Mobile header overflowed to 457 px on a 375 px screen** once "Keys" was added: the header repeated every bottom-bar link. The header now shows only what the bottom bar lacks (Settings).
3. **Dashboard filter tabs were 531 px wide on phones** (History: 385 px), which widened the whole page. The tabs now scroll sideways. The Home footer links wrap.
4. **Only one "Remove" button rendered** when two keys were saved: `UndoDelete` used a fixed `layoutId`, so framer-motion treated every instance as one element. It now uses a per-instance id.
5. **Dashboard numbers disagreed** (39 total vs 60 in the "All" tab): the cards counted Postgres rows, the tabs counted the task list, which includes local eval tasks. The cards now count the same list as the tabs.
6. React lint: the "open steps when this becomes the start card" logic moved out of an effect into a render-time state adjustment.
7. **Cancelling an idle task never reached the task list or Postgres.** `POST /task/:id/cancel` changed the task but skipped the status sink, so a cancelled task kept showing "Review plan" or "Paused" in lists. 18 of 166 list entries were stale; they inflated "Needs you" from 48 to 55. Cancel now runs the sink, and `scripts/pw/resync-registry.mts --apply` repaired the old entries (a dry run afterwards reports 0 stale).
8. History used its own status labels and showed raw `parked`. It now uses the shared labels ("Paused", "Review plan", …).

## Found along the way

- **Gemini's free quota is per Google project, and today's was gone 3 hours after the reset.** A probe at 03:09 UTC got `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 20, `retryDelay` 75,068 s, which is exactly 00:00 UTC. That confirms the UTC-midnight reset. All five Flash models were already at 20/20, and our no-credit campaign was not running then (it had stopped with the app). Something else is using the same Google project. The campaign (`--tag free-nocredit-v1`, L06–H10) was restarted detached and parks until the next reset.
- The browser pane throttles animation frames while it isn't painting, so screenshots sometimes catch entrance animations halfway. Final states were confirmed by reading `stroke-dasharray` and opacity in the DOM, not only from pictures.

## Still open in P4

- Dodo: no Pro product is configured (`DODO_PRO_PRODUCT_ID` is unset), so "Go Pro" lands on Settings, which shows "See plans" until payments exist. Also open: the credits ledger, the trial, and BYOK spending caps in the UI.
- Admission 429s (`daily_limit`, `active_limit`) have unit tests and a P3 live test; a GUI pass as a regular user is still to do. It costs real free quota, so it waits for the next reset.
