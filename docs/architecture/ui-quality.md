# UI quality pass (10-19)

## How it's checked

`frontend/scripts/ui-audit.mjs` loads every page at **360, 390, 768, 1024, 1280, 1440 and 1920 px** (13 pages: Home, Pricing, Privacy, Login, Replay signed out; Dashboard, New task, Task, History, Model keys, Settings, Pool, Analytics signed in), scrolls each to finish reveal animations, and reports:

| Check | Means |
|---|---|
| overflow | the page scrolls sideways |
| offscreen | an element sticks out of the viewport outside any scroll/clip container |
| clipped | text cut off by overflow without an ellipsis or line clamp |
| overlap | two pieces of text drawn over each other (clip-aware; ignores fixed bars and wrapped inline text) |
| target | phones/tablets: a button, input or tab under 32 px, or a link under 24 px (WCAG 2.5.8) |
| tiny | text under 10 px |
| image / console | broken images, console errors, page errors |

```
BASE=http://localhost:5174 PW_SESSION=<devin_session cookie> PW_TASK=<task id> node scripts/ui-audit.mjs [page,…]
```
Report in `.ui-audit/report.json`, full-page JPEGs per page × width (`SHOTS=0` to skip). Visual review on top of that: viewport-sized slices at 390 / 768 / 1024 / 1440, plus interactive states (Product menu on light and dark bars, phone menu, account menu, keyboard focus, signed-in home).

**Result: 862 findings on the first run → 0** (91 page × width combinations), plus the visual fixes below.

## What was fixed

**Layout bugs**
- App top bar was 1043 px wide at 768 and 1024 (owner's six links + name): icon-only links below lg, name from xl.
- Task page title was squeezed beside its status on phones ("ETag caching and per-…"): status moves under the title.
- Pricing comparison ran off phones: a plan switcher with a two-column list below md.
- Pricing table dividers broke under the sticky first column.
- Marketing nav "Start free" wrapped at 768: no-wrap, GitHub link from lg.
- Analytics KPI grid left an empty grey cell.
- How-it-works mockups had dead space under them: sized with CSS `zoom` so cards hug them.

**Behaviour bugs**
- The Product menu closed on click right after hover opened it (mouse users saw nothing).
- A message sent twice showed twice in the activity feed (the public demo replay had it): repeats within 2 minutes show once.

**Polish**
- The top bar turns dark over black bands (and its menu backdrop with it); solid light elsewhere.
- Phones: full-width hero CTA, icon grids as compact rows, two-column footer, history badge above the title, replay counter on its own line.
- History titles align on a fixed badge column; local tasks read "local · name".
- 32 px tap floor on touch screens and narrow windows; Button min heights; 10 px text floor in the mock screenshots.
- Square buttons and the key box share the radius of everything else.

**Performance**
- App pages and the dev-only landing lab load on demand: main bundle 622 KB → 270 KB (gzip 188 → 82 KB). Prerendered public pages unchanged.

## Not covered yet
- Empty and error states for a brand-new account (no tasks, no keys) — needs a fresh test user.
- Real-device checks (iOS Safari's toolbar and safe areas, Android Chrome); everything above is Chromium emulation.
- Dark mode (the site has no OS-level dark theme; only the black bands).
