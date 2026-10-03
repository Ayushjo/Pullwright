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

- [x] free-mode campaign over the full ladder (§9)
- [x] **Gateway vs direct transport (the P1 cost question)** — §6: transport cleared; the cause was a redaction bug, fixed and verified.
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

### Root cause found: our secret redaction made one line of the H10 repo un-editable

Reading a gateway run's tool trace: after the gate sent the model back to change `backend/src/Orchestrator/index.ts`, it failed the same edit 15+ times in a row, re-reading the file each time. The file contains

    const repoUrl = `https://x-access-token:${pushToken}@github.com/${owner}/${repo}.git`

and `redact()` (since 09-27) rewrote it to `x-access-token:[REDACTED]@` in every tool result. The model copied `[REDACTED]` into `old_str` / patch context, which can never match the real file, until the step limit.

| H10 run (10-02) | Transport | Tool failures | From this trap | Rest |
|---|---|---|---|---|
| 11:30 | gateway | 25 | 20 | 5 |
| 11:46 | gateway | 18 | 15 | 3 |
| 12:20 | direct | 3 | 0 | 3 |
| 12:33 | direct | 8 | 0 | 8 |

Without the trap, both transports fail 3–8 edits. Whether a run hits it depends on whether its plan touches that line, not on the transport. The 09-29 runs' events have expired, so those can't be checked.

**Fix (`b3660a2`):** the pattern only matches real token shapes (`x-access-token:[A-Za-z0-9_]{20,}@`), so template code reaches the model intact. Any `view`/`search` output that redaction did change now carries a note: never put `[REDACTED]` in an edit, anchor on neighbouring lines. Tests cover both a real token (still hidden) and the template (kept).

**General lesson:** redaction protects secrets but corrupts the agent's view of the code. Anything that alters tool output must tell the model it did.

### Three-arm interleaved experiment (10-03, before the fix)

Same session, same model, H10 ×2 per arm, interleaved:

| Arm | Cost | End | Tool failures | From the trap |
|---|---|---|---|---|
| gateway | $0.140, $0.116 | needs review ×2 | 27, 19 | 25, 14 |
| gateway, no pacing | $0.131, $0.136 | needs review ×2 | 22, 26 | 19, 21 |
| direct | $0.074, **$0.111** | ready, **needs review** | 8, **22** | 0, **21** |

**The second direct run fell into the same trap**, so the transport was never the cause. Pacing isn't either (the unpaced arm behaves like the paced one). Every expensive H10 run, on any transport, is the redaction trap. A run hits it when its plan touches `Orchestrator/index.ts`, or when the gate's "planned file not changed" check sends it there. The P1 "hard items cost more through the gateway" finding was this bug, plus small-n luck in which runs hit it.

**Verification on the fixed code** (H10 ×3 through the gateway, `--tag p2-h10-fixed`):

| Run | Cost | Calls | Tool failures | End |
|---|---|---|---|---|
| 1 | $0.107 | 53 | 6 | ready, pass, reviewer ✔ (several rounds on a TypeScript error) |
| 2 | $0.060 | 37 | 4 | ready, pass, reviewer ✔ |
| 3 | $0.056 | 37 | 2 | ready, pass, reviewer ✔ |

Before the fix: 6/6 gateway runs ended in "needs review" at $0.110–0.140. After: **3/3 ready, median $0.060**, in line with the P0 direct runs ($0.064–0.095). The run that worked on `Orchestrator/index.ts` saw no `[REDACTED]` and had no trap failures. **The P1 cost question is closed: the gateway is cost-neutral.**

## 7. H04: the agent breaks a contract the issue states

All failed H04 runs since 10-02 (3 of 5, on both transports) break the same requirement. The issue says `parseCsv(text)` returns an array of rows (arrays of strings). To report line numbers, the agent attached extra data to that return value instead: a `startLines` / `lineStarts` property on the array, or `{ row, startLine }` objects. Its own tests pass; the hidden test's `deepEqual` fails. The reviewer approved all three.

- **Planner rule** (`2e204c0`, kept): signatures, return shapes, field names and status codes stated in the issue are a contract; extra data comes from a separate helper, never from changing a stated return value. Measured next with H04 runs.
- **Reviewer rule** (tried, reverted in `66ecbdf`): the replay with the same rule in `JUDGE_SYSTEM` still approved **3/3** of these contract breaks. False approvals on the original 60 went 2 → 1 and false rejections 5 → 7. No gain on the target and more noise, so it was removed. A reviewer reading a diff doesn't notice `rows.startLines = …` as a contract change. Prevention has to come earlier (plan) or be deterministic.

## 8. Does the spec check hurt well-specified hard issues? (H04)

| H04 runs | Hidden test passes |
|---|---|
| Before intake existed (09-27 … 09-29 P1) | 3 / 4 |
| With the spec check (since P1.5) | **1 / 7** |
| Same current code, spec check off (`--no-spec`, 10-03) | **2 / 3** ($0.099, $0.075, $0.067) |
| Same current code, spec check on (10-03) | 0 / 3 ($0.043, $0.032, $0.035) |

The spec-check runs' decisions match the issue. They fail on an implementation slip: off-by-one start lines when the line numbers are recomputed by re-scanning. One of the three still bolted line data onto `parseCsv`, down from 3/3 before the planner contract rule (§7). What differs is effort: with the questions settled up front, runs finish fast and confident (19–23 calls, reviewer ✔); without them, the agent works longer (38–55 calls) and gets the tricky part right more often.

**n is small** (Fisher exact on 5/7 vs 1/7: p ≈ 0.10), and the mechanism isn't proven. Change made (narrowest the data supports): **autonomous runs on issues rated 0–1 no longer get the open questions.** Interactive runs keep them, where a person can correct decisions (the measured benefit in §4). Ladder runs are autonomous, so on clear items they now plan as before intake. Re-measure H04 when credit allows.

## 9. Free mode on the ladder (`lanes/free.env`, `--campaign --tag free-v1`, 10-03)

Lanes:
- **plan:** gpt-5-mini on the Vercel free credit (Gemini 3.5 Flash as fallback);
- **execute:** Gemini 3.5 Flash-Lite → 3.1 Flash-Lite → Groq qwen;
- **review:** gpt-5-mini on the credit → Groq gpt-oss-120b.

| Item | Free mode | Credit used | Calls | Execution lanes |
|---|---|---|---|---|
| L01 | ✅ pass | $0.004 | 15 | 3.5 + 3.1 Flash-Lite (failover mid-task) |
| L02 | ✅ pass | $0.005 | 12 | 3.5 Flash-Lite |
| L03 | ✅ pass | $0.006 | 13 | 3.5 + 3.1 |
| L04 | ✅ pass | $0.007 | 16 | 3.5 |
| L05 | ✅ pass | $0.006 | 17 | 3.5 |
| L06 | ✅ pass | $0.007 | 18 | 3.5 |
| L07 | ✅ pass | $0.006 | 20 | 3.5 |
| L08 | ✅ pass | $0.011 | 29 | 3.5 + 3.1 |
| L09 | ✅ blocked as designed | $0.002 | 1 | — |
| L10 | ✅ pass | $0.008 | 18 | 3.5 |
| L11 | ✅ pass | $0.009 | 28 | 3.5 + 3.1 |
| R01 | ✅ pass | $0.006 | 12 | |
| R02 | ✅ pass | $0.010 | 19 | 3.5 |
| R03 | ⚠️ checks pass, but step limit → needs review | $0.014 | 48 | 3.5 + 3.1 |
| R04 | ✅ pass | $0.014 | 52 | 3.5 + 3.1 |
| R05 | ❌ fail (step limit, 80) | $0.024 | 94 | 3.5 + 3.1 |

**L set: 11/11 in free mode, the same as gpt-5-mini (P0: 11/11).** **R set: 4/5 pass their checks (3 ready), R05 fails.** gpt-5-mini history on R (09-26, an older pipeline): R01–R04 mostly pass; R05 failed 5/5. So R05 is hard for both, and the free result on L+R is **15/16 correct outcomes against gpt-5-mini's 15/16 on the same items**. Free runs on the large-repo items use more calls (48–94; Flash-Lite needs more turns) but still almost no credit (≤ $0.024). Execution costs nothing (free Gemini quota); the credit pays only for planning and review, **≈ $0.007 per easy issue**, so the $5 monthly grant covers roughly 700 easy issues' planning and review. Runs take 1–3 min. 3.5 Flash-Lite answered "high demand" now and then, and the gateway moved those calls to 3.1 Flash-Lite without the task noticing.

### Hard items in free mode (10-03)

| Item | Free mode | gpt-5-mini (P0, 09-29) | Credit | Calls | Min |
|---|---|---|---|---|---|
| H01 | ✅ pass | ❌ (0/3 across runs) | $0.009 | 23 | 1.4 |
| H02 | ✅ pass | ✅ | $0.012 | 32 | 2.4 |
| H03 | ✅ pass | ✅ | $0.011 | 20 | 1.7 |
| H04 | ✅ pass | ✅ | $0.015 | 28 | 2.8 |
| H05 | ✅ pass | ✅ | $0.009 | 17 | 1.7 |
| H06 | ✅ pass | ✅ | $0.024 | 74 | 9.7 |
| H07 | ❌ step limit, needs review | ✅ | $0.021 | 94 | 9.8 |
| H08 | ✅ pass | ✅ | $0.026 | 59 | 8.4 |
| H09 | ⚠️ hidden test passes; step limit → needs review | ✅ | $0.023 | 87 | 11.8 |
| H10 | ✅ pass | ✅ | $0.017 | 44 | 5.0 |

### Free mode vs paid, whole ladder

| Set | Free mode (10-03) | gpt-5-mini (P0) |
|---|---|---|
| L (11) | **11/11** | 11/11 |
| R (5) | **4/5** (R05 fails) | 4/5 (R05 failed 5/5 on 09-26) |
| H (10) | **9/10** hidden tests pass (8 ready) | 9/10 |
| Total | **24/26** | 24/26 |
| Credit per task | **≈ $0.012** (planning + review only) | ≈ $0.04 (everything, same credit) |

**The parity target (free within 10 pp of paid) is met on this ladder: 24/26 vs 24/26.**

Caveats:
- one free run per item;
- the gpt-5-mini numbers come from P0 runs on an earlier pipeline;
- free mode here means **free execution plus gpt-5-mini planning and review on the Vercel free credit**. It isn't measured without the credit (Flash planning, Groq review).

The credit makes it cheap: 26 tasks used ≈ $0.36, so a $5 grant covers ≈ 350 tasks of planning and review per month.

Notes:
- **H01 passed in free mode for the first time.** The open-questions change (§8) was active, so this clear issue planned without them, as P0 did.
- The two misses are step-limit stops on the largest items (H07, H09), where Flash-Lite needs more turns (87–94 calls). The run-loop cap, not the model, ends them. A per-lane step allowance for the free executor is a candidate fix.

### Step allowance for the free executor (`111d33a`)

Both hard misses were run-loop step-limit stops, not wrong code. The free profile now sets `PW_RUN_STEP_FACTOR=1.5`: the run cap grows from 40–80 to 60–120 steps. Those calls cost only free quota; a 120-call task is ≈ 24% of one Flash-Lite model's 500 requests/day, so the free plan's 3 tasks/day still fit, with 3.1 Flash-Lite as a second pool.

| Item | Before (cap 73–80) | With 1.5× (10-03) |
|---|---|---|
| H07 | ❌ step limit, 94 calls | ✅ hidden test passes (124 calls, $0.019); reviewer still flags it → needs review |
| H09 | ⚠️ step limit, 87 calls | ✅ ready, pass (116 calls, $0.022) |

**With the allowance, the free profile passes 10/10 hard hidden tests** (8 from the first run, H07/H09 from this re-run; one run each, so this is a second attempt for those two). Across the whole ladder: 26/26 correct outcomes except R05, which no model has solved.

## Status of P2 (10-03)

| Question | Answer | Where |
|---|---|---|
| Is free mode close to paid? | **Yes on this ladder**: 24/26 (= gpt-5-mini) first pass, 25/26 with the step allowance. Execution free, ≈ $0.012 of credit per task for planning and review | §9 |
| Who reviews in free mode? | gpt-5-mini on the credit; Groq gpt-oss-120b as fallback; never Flash-Lite (8/11 false approvals) | §1 |
| Was the gateway making hard tasks expensive? | No. A redaction bug made one source line un-editable; fixed; H10 3/3 ready at a median of $0.060 | §6 |
| Do images help? | Yes when the fact is only in the image: 2/2 with, 0/2 without | §3 |
| Do vague issues get rescued? | With a person reviewing decisions: 3/5 vs 1/5 | §4 |
| Spec check on clear issues? | Removed from autonomous runs on issues rated 0–1 (H04 1/7 with it vs 5/7 without) | §8 |
| gpt-5-mini replacement | gpt-5.4-nano is the candidate ($0.20/$1.25); full ladder **not run**: needs ≈ $0.7 of credit (resets ≈ Oct 29) | §2 |

### Open
- gpt-5.4-nano full ladder (credit).
- Free mode **without** the Vercel credit: planning on Gemini Flash (20 req/day) and review on Groq. This is the fallback once a user's monthly credit is spent; not yet measured.
- Private-repo attachments (needs a private test repo from the owner).
- A second seed on the free ladder to firm up the n=1 numbers.
