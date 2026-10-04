# Totally free mode — no credit, no card

_Planned 2026-10-03. Section of the Pullwright SaaS plan; numbers measured on the owner's keys unless marked._

## The problem

The measured free mode (24/26, same as gpt-5-mini) gets planning and review from gpt-5-mini on the **Vercel AI Gateway's $5 monthly free credit**. That's free to the user, but it assumes they made a Vercel account and key. A user who only has the no-card keys must still get a working, honest free plan.

## What a user can get for free without a card (measured)

| Source | How to get it | What it gives us | Limits (measured / seeded) |
|---|---|---|---|
| **Gemini API (Google AI Studio)** | Google account, 1 minute | Flash pool: 3.5 / 3.6 / 3.7 / 3.8 / 3-flash-preview (tools, JSON, two-turn all ✓ on 10-03) | ~20 requests/day **each** → **~100/day per Google project**; frequent "overloaded" 503s, so a pool with failover is mandatory |
| | | Flash-Lite pool: 3.5 / 3.1 | ~500/day each → ~1,000/day |
| **Groq** | email signup, no card | gpt-oss-120b (text) | 1,000 req/day, **8K tokens per request, ~200K tokens/day ≈ 35–40 reviews/day** |
| | | qwen3.8-27b (reads images) | 1,000 req/day, 8K per request |
| OpenRouter (optional) | email signup | `:free` models | 50 req/day total (1,000 after a one-time $10 top-up) — models not yet qualified |

Not used: NVIDIA build (terms say dev/test/eval only), Gemma (leaks its thinking into answers), Flash-Lite as reviewer (approved 8 of 11 broken patches).

## The job of each role, and who can do it for free

| Role | Calls per task (measured) | Needs | Free candidates | Can't do it |
|---|---|---|---|---|
| Spec check | 1 | judgement, JSON | Flash pool | — |
| **Plan** | 2–13 (+ re-plans) | the most reasoning; read-only tool loop; prompts 5–15K tokens | **Flash pool** → Flash-Lite as last resort (flagged) | Groq (8K cap: a plan loop outgrows it after a few file reads) |
| Execute | 12–124 | volume | Flash-Lite pool (measured: 25/26 with the credit planner) | — |
| **Review** | 1–3 | judgement, JSON | **Groq gpt-oss-120b** (replay: 1 false approval of 9, 3 false rejections of 34; compact rendering fits 8K) → **Flash pool** (to measure) | Flash-Lite (8/11 false approvals) |
| Read images | 0–6 | vision | Groq qwen3.8-27b → Flash-Lite (both read every value exactly) | gpt-oss |

## Daily budget for the free plan's 3 tasks/day (one Google project + one Groq account)

| Role | Per task | 3 tasks | Free capacity | Headroom |
|---|---|---|---|---|
| Plan + spec check (Flash pool) | ~9 | ~27 | ~100 | ~3.7× (room for re-plans and 503 retries) |
| Review (Groq, Flash fallback) | ~1.5 | ~5 | ~35–40 Groq + Flash | ample |
| Execute (Flash-Lite pool) | 12–124 | ≤ 372 worst case | ~1,000 | ≥ 2.7× |

**Capacity is there.** The open question is **quality**: is a free Flash model a good enough planner and reviewer?

## Routing rule (what the product does)

For the T1 roles (spec check, plan, review), the router picks the first eligible lane in this order:

1. the user's paid key (Balanced / Max modes only);
2. the user's **free credit** (Vercel / OpenRouter credits / HF), when present and not exhausted;
3. **Gemini Flash pool** (free key);
4. review only: **Groq gpt-oss-120b** (if the compact prompt fits) — placed *before* Flash if measurement shows it reviews better;
5. plan only, last resort: Flash-Lite, with a "lower-quality plan" notice and the plan shown for approval.

Execution keeps Flash-Lite → Groq qwen (small prompts). The free step allowance (1.5×) applies.

**Minimum to use the free plan: one free Gemini key.** Groq is recommended (better reviewer, image reader, second quota). Onboarding asks for Gemini first ("2 minutes, no card"), then offers Groq. The capacity meter shows what the user's keys allow ("3 tasks/day; plans on Gemini Flash").

**Private repos in totally-free mode:** Gemini's free tier may train on prompts, and Groq can't plan, so a private repo needs the user's explicit consent, or a non-training key. The preflight says this before the task starts.

**When the credit runs out mid-month** (users who do have Vercel): the same rule falls through to step 3 automatically. No error, a notice "planning on Gemini Flash until your credit renews".

## Measurement plan (all $0 — quota only)

1. **Reviewer:** replay a balanced 30-item subset (all 14 known-bad + 16 known-good patches) through the Flash pool. Compare with gpt-5-mini (2/11 false approvals) and Groq (1/9). Picks the review order (step 4).
2. **Full pipeline, no credit:** profile `lanes/free-nocredit.env` (plan: Flash pool → Flash-Lite; execute: Flash-Lite pool → Groq qwen; review: Groq → Flash pool), the whole 26-item ladder in campaign mode (`--tag free-nocredit-v1`). About 230 plan calls at ~100/day, so the campaign pauses at the daily cap and finishes in 2–3 days.
3. **Gate:** ≥ 22/26 (within 10 points of paid's 24/26). If the Flash planner falls short:
   - (a) give the planner more read steps;
   - (b) plan on the best-measured single Flash model and keep the others for failover;
   - (c) be honest in the product: show "free plan quality: good for small/medium issues" and offer the Vercel credit as the one-click upgrade that is still free.

## Results so far (10-03)

### Reviewer without credit (same 30 items: all 14 known-bad + 16 known-good)

| Reviewer | False approvals | False rejections | Judged |
|---|---|---|---|
| gpt-5-mini (credit, for reference) | 2 / 11 | 1 / 15 | 26 / 30 |
| **Groq gpt-oss-120b** | **1 / 9** | 0 / 9 | 18 / 30 (8K cap on large patches, daily token cap) |
| Gemini Flash pool | 4 / 14 | 2 / 12 | 26 / 30 (4 lost to the daily cap) |

**Decision:** in no-credit mode Groq reviews first and the Flash pool is the fallback, which is what `lanes/free-nocredit.env` does. Flash is a weaker reviewer than either, but far better than Flash-Lite (8/11).

### Facts learned from Google's own quota errors

- The free limit is **20 requests per day per model per project** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, value 20), confirmed for the Flash models; `gemini-3-flash-preview` stops at the same point.
- **The daily quota resets at 00:00 UTC, not Pacific midnight**: RetryInfo said 46,586 s at 11:03 UTC. The registry now uses UTC (`fb2a0c8`).
- For the product: the free plan's "resets at" time shown to users is 00:00 UTC.

### Ladder without credit (`--tag free-nocredit-v1`, in progress)

| Item | Result | Planner models used |
|---|---|---|
| L01 | ❌ hidden test: wrote `"start": "node ."`. It works (`main` is `src/server.js`), but the test wants the literal `node src/server.js` | 3.6 Flash, 3-flash-preview |
| L02 | ✅ | 3-flash-preview, 3.8 |
| L03 | ✅ | 3.6, preview |
| L04 | ✅ | 3.7, 3.8, 3.5 |
| L05 | ✅ | 3.7, 3.8, 3.5 |
| L06 … H10 | paused: the Flash pool's ~100 requests/day were used by today's probes, this replay and 6 tasks. The campaign resumes at 00:00 UTC and needs 2–3 days | |
| L06 … H10 (10-04) | restarted 03:05 UTC; parked at once. Google already reported 20/20 on all five Flash models (`…PerDayPerProjectPerModel-FreeTier`, retry 75,068 s = 00:00 UTC). Our campaign wasn't running after the reset, so another user of the same Google project spent it. Resumes 10-05 00:00 UTC | |

Each task used ≈ 8 Flash requests (spec check + planning), so a single user's 3 tasks/day need ≈ 25 of the ~100. The budget in the table above holds.

## Update 10-04: a third free reviewer

A free **OpenRouter** key adds a reviewer as safe as gpt-5-mini on the replay set: Nemotron 3 Super, 2/14 false approvals (both H01) and 1/10 false rejections. Groq gpt-oss had 1/9 false approvals and the Flash pool 4/14. It has no 8K request cap, so it also covers the large-repo patches Groq can't take. Only 50 free requests a day per OpenRouter account, so it sits after Groq in the review order. As a planner it is not yet measured: one H03 attempt ran out of daily quota after 14 calls, still planning. See qualification.md §10.

