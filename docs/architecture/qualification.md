# P2 — Qualification

_Started 2026-10-02. Every number here is measured on the owner's keys unless marked. Raw rows: `backend/.spend/judge-probes.jsonl`, `eval-results.jsonl` (tagged), `spec-probes.jsonl`._

## Goal

Decide the free-mode defaults with numbers, not guesses: which model reviews, which executes, how far free is from paid, and what replaces gpt-5-mini before OpenAI shuts it down (Dec 11, 2026).

## Tools built for it

| Tool | What it does |
|---|---|
| `GET /api/quota` | used / limit per configured lane, per minute and per provider day |
| `eval.mts --campaign` | pauses when a role's lanes are ≥ 90% of their daily cap or cooling down; a task killed by exhausted quota is retried after the reset and not counted |
| `eval.mts --tag` | labels result rows so runs can be compared |
| `eval.mts --simulated-user` | plans are not auto-approved; a model holding the item's full issue answers questions and reviews the plan's decisions, changing those that contradict the full issue (Ambig-SWE / Ask-or-Assume protocol) |
| `evals/judge-replay/` + `probe-judge.mts` | 60 stored (patch, plan, verification) inputs with a known hidden-test result (49 pass / 11 fail), replayed through each reviewer candidate |
| `evals/multimodal.json` M11/M12 | items whose key fact exists only in the image (availability legend; "Unknown" decade row), each with a no-image control |

## 1. Reviewer qualification (replay of 60 labelled items)

The dangerous error is a **false approval**: the hidden test fails but the reviewer says the patch is fine, so a broken PR reaches the user.

| Reviewer lane | Judged | False approvals (of 11 bad) | False rejections (of 49 good) | Cost | Latency |
|---|---|---|---|---|---|
| **gpt-5-mini (Vercel) — today's reviewer** | 60/60 | **2 / 11** (both H01) | 5 / 49 | $0.142 ($0.0024 each) | 19 s (shared 5 RPM) |
| Gemini 3.5 Flash-Lite (free) | 60/60 | **8 / 11** | 1 / 49 | $0 | 4.9 s |
| Groq gpt-oss-120b (free) | 43/60 | **1 / 7** judged (H01) | 3 / 36 | $0 | 45 s incl. waiting |
| Groq qwen3.8-27b (free) | 39/60 | **0 / 8** | **12 / 31** | $0 | 59 s incl. waiting |

gpt-oss-120b's 17 unjudged items: 7 too large for the 8K request cap (every H07, some H06/H08 — the large-repo fixture), 3 JSON-mode failures ("Failed to generate JSON"), and **7 refused because the lane hit Groq's free daily token cap (200K tokens/day)** after ~40 reviews. A compact review rendering now exists for the 8K cap (`191ee90`); the daily cap is a hard ceiling: **≈ 35–40 reviews per day per Groq account** at today's prompt sizes.

**Findings so far**
- **Flash-Lite is disqualified as reviewer**: it approves almost anything (8 of 11 bad patches, including an H03 run with 6 failing tests). Cheap and fast, but it does not catch errors.
- **Groq's real limit for reviews is tokens per minute, not requests per day.** Its free tier allows 8K tokens/min; a review prompt is 5–7K, so the gateway paces it to about **one review per minute**. Fine for one task; a problem for several at once.
- **gpt-5-mini is a strict reviewer**: 5 of 49 good patches rejected (they then go through a fix round, which costs calls but not correctness) and only the two H01 cases approved wrongly.
- **qwen3.8-27b never approved a bad patch but rejected 39% of good ones** (12/31). Every rejection sends the task into a fix round (more calls) or to "needs review", so it is too strict to be the default. Its 21 unjudged items are all Groq's daily token cap.
- **Where it can review, gpt-oss-120b is as safe as gpt-5-mini** (1 false approval, the same H01 case) and a little less strict (3 false rejections of 36). Its limits are capacity, not judgement: 8K per request and 200K tokens per day.
- **Groq gpt-oss-120b can't review large-repo patches**: 7 of its first 28 inputs (every H07 and some H06/H08, the MyOwnDevin fixture) exceed the 8K request cap, and it failed JSON mode twice. It fits the small fixture only.
- The hard cases are the three **H01 (persistence) patches**: they look complete, match the plan, but fail the hidden test because the spec wanted a synchronous store and the agent chose async. Even gpt-5-mini approved 2 of 3. No reviewer can see a hidden spec; this is the intake problem (settle sync/async from the code's conventions), which P1.5 now addresses.

**Reviewer decision (free mode):** gpt-5-mini on the Vercel free credit stays the reviewer (≈ $0.0024 per review, ≈ 750 reviews per $5 grant). Groq gpt-oss-120b is the fallback when the credit is gone, for patches that fit its 8K cap (compact rendering, `191ee90`), within ≈ 35–40 reviews/day. Flash-Lite is never used as reviewer; qwen only as a last resort.

## 2. Replacing gpt-5-mini (shutdown Dec 11, 2026)

Vercel AI Gateway prices on 2026-10-02 (per 1M tokens, in / out / cached):

| Model | Price | Note |
|---|---|---|
| gpt-5-mini | $0.25 / $2.00 / $0.025 | today's default; 10/10 hard issues |
| gpt-5-nano | $0.05 / $0.40 / $0.005 | 3/5 in the Sept comparison; failed both hard items |
| **gpt-5.4-nano** | $0.20 / $1.25 / $0.020 | 4/5 (its miss was our bug); **the realistic successor** |
| gpt-5.4-mini | $0.75 / $4.50 / $0.075 | 3× gpt-5-mini |
| gpt-5.6-terra | $2.00 / $12.00 / $0.20 | OpenAI's suggested replacement: **8× gpt-5-mini, not a drop-in** |

Decision: qualify **gpt-5.4-nano** on the full ladder (step 4 below). gpt-5.6-terra is a candidate only for the paid "Max" mode.

## 3. Image items (fact only in the image)

gpt-5-mini pipeline, transcripts by Groq qwen3.8-27b (free), one run each:

| Item | With the image | Without it (control) |
|---|---|---|
| M11 availability badge (legend: "in stock" ≥ 5, "low" 1–4, "out of stock" 0) | **pass** $0.014 | **fail** $0.014 — guessed `"low stock"` and a ≤ 5 threshold |
| M12 "Unknown" decade row | **pass** $0.018 | **fail** $0.014 |

Unlike the Sept M05 item (whose fact was also in a code comment), these two depend on the image: **2/2 pass with it, 0/2 without**. The transcript alone (no pixels to the executor) was enough.
The no-image control also shows the spec check working as designed: it rated M11n "mostly clear" (1) and listed the threshold as an open question with a default — exactly the case a user would fix with one click at plan approval.

## 4. Vague issues end to end, with a simulated user

`eval.mts --simulated-user --tag p2-vague-sim`: gpt-5-mini plans; a gpt-5-mini stand-in user who holds the full issue answers questions and reviews the plan's decisions once (the Ambig-SWE / Ask-or-Assume protocol).

| Item (vague text) | Before intake (silent guess) | With intake + simulated user | Notes |
|---|---|---|---|
| V02 "dividing by zero gives a weird result" | pass | **pass** $0.012 | user tightened the error message; 1 re-plan |
| V06 "users want to filter the book list" | fail (`?q=`) | **pass** $0.018 | user switched `?q=` → `author`/`tag`; 1 re-plan |
| V07 "POST /cart/quote sometimes returns 500" | fail (200 + total 0) | **fail** $0.020 | the plan's two decisions didn't cover the one that mattered (400 for bad input), so the user had nothing to correct |
| V10 "books endpoint returns too much data" | fail (strip fields) | **pass** $0.036 (reviewer rejected) | user switched to pagination; 1 re-plan |
| VH01 "inventory changes are lost on restart" | fail (write into the bundled file) | **fail** $0.023 | user changed decisions, but the hidden spec (separate atomic `JsonStore`, `fromStore`) is too specific to recover from 5 choices |

**3/5 resolved vs 1/5 before** — in line with the published recovery rates (Sonnet 4 recovered 89% of full-spec performance; smaller models 54–59%). The misses show the two remaining gaps:
- the decisions list must include the *behaviour that fixes the complaint* (V07 asked about body shape and status codes in general, not "what should happen on bad input"), and
- some specs can't be recovered by choosing among options at all (VH01 names new classes and methods) — those need the asker to describe the API, which only a real user can do.
No question was asked outright in these 5 runs (all underspec ≤ 2 without a blocking item); every correction came through the plan's decisions.

## 5. Open steps

- [ ] free-mode campaign over the full ladder (`lanes/free.env`, `--campaign --tag free-v1`)
- [~] **Gateway vs direct transport (the P1 cost question)** — see §6.
- [x] (superseded) 2 more gpt-5-mini runs each of H04 and H10 (the P1 cost question). So far: H04 $0.049 **fail** then $0.024 pass; H10 $0.120 pass (judge rejected). Since P1, H04 is 2 pass / 2 fail (3/3 before) and every H10 run costs $0.106–0.121 with 61–75 calls (P0: $0.064–0.095, 43–57). Six runs point the same way, so an A/B with the gateway bypassed (`lanes/direct.env`, `PW_GATEWAY=off`) runs next, same day, same model.
- [ ] gpt-5.4-nano on the full ladder
- [x] vague set end to end with `--simulated-user` (§4)

## 6. Gateway vs direct transport

P1 left a question: hard items cost more through the new gateway. Runs so far (gpt-5-mini on Vercel, same code apart from transport):

| H10 run | Transport | Cost | Calls | Tool failures | End |
|---|---|---|---|---|---|
| 09-29 P0 ×2 | direct | $0.095, $0.064 | 57, 43 | 9, 4 | ready |
| 09-29 P1 ×2 | gateway | $0.106, $0.121 | 69, 61 | 23, 19 | step limit / budget cap |
| 10-02 ×2 | gateway | $0.120, $0.110 | 75, 64 | 25, 18 | step limit |
| 10-02 ×2 | direct (`PW_GATEWAY=off`) | $0.053, $0.080 | 34, 55 | 3, 8 | ready, pass |

Eight runs separate cleanly: direct 3–9 tool failures, gateway 18–25. H04 failed its hidden test on both transports (2/2 direct), so H04's failures are the item's own flakiness, not the transport.

**What is *not* the cause (checked):**
- request body — built from both paths for the same call and diffed: identical (`.tasks/scratch/bodydiff.mts`); only `attempts` (1 vs 3) and `timeoutMs` (90 vs 120 s) differ;
- errors, retries, timeouts — none in the backend logs for the gateway runs; longest call 12.6 s;
- caching — the gateway runs had *higher* cache hit rates (85–88% vs 79–81%).

**What remains:** wall-clock pacing. The gateway keeps Vercel's free tier under 5 requests/min per model, so a gateway run takes 13–19 min where a direct run takes 6–10. An interleaved three-arm run is in progress (`--transport`: gateway / gateway without pacing / direct, 2 runs each, same session).
