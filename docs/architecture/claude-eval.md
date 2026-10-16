# Claude models on Pullwright: quality and cost (10-16)

Question: if the free plan ran on our own Anthropic key, how well would each Claude model handle easy, hard, vague and very vague issues, and what would each task cost?

Budget for this evaluation: $60 hard cap. It is enforced by the platform spend ledger: `SPEND_HARD_STOP_USD = 2.4232` (spend before the evaluation) + $60 = **$62.43**, set in the backend profile and passed to the eval runner as well.

## Setup

- **Native adapter** (`src/llm/anthropic.ts`, `d225e9f`). It sits behind the same `chat()` contract and spend ledger as every other provider.
  - Automatic prompt caching.
  - Adaptive thinking: every Claude turn is replayed byte-for-byte, with `block_binding.prefix_mismatch_behavior: "drop_block"` as a safety net. Every run so far had an empty `input_transformations` (nothing was dropped).
  - `tool_choice: auto`, since forced tool use is a 400 on Opus 5.5, Sonnet 5.5 and Fable 5.1.
  - Server-side refusal fallback `"default"`.
  - Images as base64 blocks.
  - Cost from the real `usage`: cache writes at 1.25× input, reads at the cache price.
  - Smoke-tested two-turn tool calls on Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1: turn 2 hit the cache (2,802 of 2,888 input tokens) and nothing was dropped.
- **Profiles** (`.tasks/scratch/claudeProfile.sh <model> <taskCap>`): one model on every role (plan, spec check, execute, review, vision), effort `medium`, per-task cap generous enough to measure natural cost.
- **Items**:
  - the 26-item ladder (L easy, R real-repo, H hard), scored by hidden acceptance tests;
  - 6 image items (M; the `n` variants have the image removed, so the fact can't be known, as a control);
  - 5 vague items (V) and 3 new **very vague** one-liners (VV, `48854eb`: "The book list is getting huge.", "We need a way to load lots of books at once.", "History and the dashboard get slow when there are many tasks."), each scored by its base item's hidden test. Vague items run with `--simulated-user`: a model holding the full original issue answers only what the agent asks and reviews the plan once. The simulated user is always Haiku 5.5, so it's the same for every model under test.
- One run per item per model.

## Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50 per MTok) — `--tag claude-haiku-v1`

| Set | Hidden test passed | Mean $ | Median $ | Max $ | Mean min |
|---|---|---|---|---|---|
| L easy (11) | **11/11** (L09 correctly blocked) | 0.0056 | 0.0060 | 0.0091 | 0.7 |
| R real repo (5) | **4/5** | 0.0359 | 0.0203 | 0.1222 | 4.0 |
| H hard (10) | **8/10** | 0.0238 | 0.0232 | 0.0565 | 2.6 |
| M image (6) | **4/6**: both "with image" variants passed, both no-image controls failed as expected | 0.0070 | 0.0067 | 0.0085 | 0.8 |
| V vague (5) | **4/5** | 0.0101 | 0.0113 | 0.0167 | 1.2 |
| VV very vague (3) | **1/3** | 0.0290 | 0.0166 | 0.0587 | 3.4 |
| **All 40** | **32/40** | **0.0165** | 0.0094 | 0.1222 | |

Total: **$0.66 for 40 tasks.** Cache hit rate ≈ 70–83% of input tokens.

Against earlier runs (base ladder L+R+H, 26 items):

| Configuration | Ladder | Cost per task |
|---|---|---|
| gpt-5-mini (P0) | 24/26 | ≈ $0.04 |
| Free mode with credit (Flash-Lite executor + gpt-5-mini planner and reviewer, §9) | 24/26 | ≈ $0.012 of credit |
| No credit (Gemini + Groq) | 13/13 so far, L01 failed earlier | $0 |
| **Haiku 5.5, all roles** | **23/26** (24/26 counting the H06 re-run) | **≈ $0.016** |

Notes:
- **L01**, failed by every free configuration (literal `node src/server.js` expected), passed.
- **H01**, 0/3 for gpt-5-mini, passed.
- **R05** has never been solved by any model. Haiku stopped at needs-review after 80 calls ($0.12, the most expensive task).
- **H09** failed its hidden test although Haiku's own reviewer approved it.
- **H06 and V10 were adapter failures**: "Model repeatedly failed to call a tool". With `tool_choice: auto`, Haiku answered in text three times in a row. Fixed in `4fe2638`: a constant, cache-stable system note says every turn must call a tool. After the fix (`--tag claude-haiku-v1b`) **H06 passes its hidden test** (needs-review; Haiku's reviewer was unsure, $0.046) and **V10 passes** (ready, $0.011). **With the fix Haiku 5.5 is 34/40, and 34/38 excluding the two no-image controls.**
- **Vague items: Haiku never asked a question** (0 on all 8). It assumed, and the simulated user approved the plan. That works when the assumption matches (V02, V06, V07, VV10, VH01) and fails when the issue hides a specific contract (VVH04's CSV rules, VVH06's API shape).
- The eval runner kept `.env`'s $3 hard stop for the simulated user's own calls. Once platform spend passed $3 the V10 re-run stopped with `SpendLimitError`, which is correct behaviour for the wrong cap; it was re-run with the evaluation's cap passed to the runner.

## Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10 per MTok) — `--tag claude-sonnet-v1`

Run with the tool-call note from the start; the runs from L03 onward were attached to the owner's account (`PW_EVAL_OWNER`) so they were visible live in the dashboard.

| Set | Hidden test passed | Mean $ | Median $ | Max $ | Mean min |
|---|---|---|---|---|---|
| L easy (11) | **11/11** | 0.072 | 0.076 | 0.111 | 0.7 |
| R real repo (5) | **5/5**, including **R05** | 0.336 | 0.268 | 0.903 | 2.8 |
| H hard (10) | **10/10** | 0.275 | 0.239 | 0.589 | 2.1 |
| M image (6) | **4/6** (both no-image controls failed as expected) | 0.086 | 0.087 | 0.099 | 0.7 |
| V vague (5) | **3/5** | 0.128 | 0.135 | 0.151 | 1.1 |
| VV very vague (3) | **1/3** | 0.263 | 0.210 | 0.463 | 2.2 |
| **All 40** | **34/40** (34/38 without the controls) | **0.179** | 0.113 | 0.903 | |

Total: **$7.17 for 40 tasks**, about 11× Haiku.

- **Base ladder 26/26.** This is the first configuration to pass every L, R and H hidden test.
  - R05 (cancellation) had failed for every earlier model, including gpt-5-mini 0/5 and Haiku. Sonnet passed it in 30 calls for $0.90, the most expensive task in the run.
  - H09, which Haiku failed, passed.
- **Fewer calls than Haiku** on hard work (H mean 13 vs 18; H07 22 vs 39), but each call costs ~20× more.
- **Vague and very vague items are the weak spot: 4/8**, the same as Haiku's 5/8 within noise. Every miss is a *ready* task that the reviewer approved but whose hidden test failed. The agent built a reasonable reading of the vague issue that wasn't the one the hidden test encodes (V07's validation rules, VH01's storage format, VVH04's CSV rules, VVH06's API shape). Sonnet asked the simulated user once on 5 of the 8 items (Haiku never asked), and one answer wasn't enough to pin the contract down.

## Opus 5.5 (`claude-opus-5-5`, $4 / $20 per MTok) — `--tag claude-opus-v1`

All 40 items, visible live in the owner's dashboard.

| Set | Hidden test passed | Mean $ | Median $ | Max $ | Mean min |
|---|---|---|---|---|---|
| L easy (11) | **11/11** | 0.173 | 0.202 | 0.239 | 1.0 |
| R real repo (5) | **4/5** (R05 → needs review) | 0.755 | 0.603 | 2.056 | 3.8 |
| H hard (10) | **10/10** | 0.646 | 0.594 | 1.085 | 3.3 |
| M image (6) | **4/6**: both "with image" passed; on M11n it **stopped and asked** what the availability values should be (correct, since the fact is only in the missing image) | 0.194 | 0.218 | 0.283 | 1.0 |
| V vague (5) | **5/5** | 0.327 | 0.368 | 0.465 | 1.8 |
| VV very vague (3) | **2/3** (VVH06 failed) | 0.761 | 0.500 | 1.530 | 3.9 |
| **All 40** | **36/40** | **0.430** | 0.291 | 2.056 | |

Total: **$17.22 for 40 tasks**, ≈ 2.4× Sonnet and 26× Haiku.

- **Best on vague work: 7/8**, against 4/8 for Sonnet and 6/8 for Haiku (both counting fixes). Opus reads intent better from thin issues. It asked the simulated user on 3 of 8 and assumed well on the rest.
- **The only model that refused to guess on a missing image** (M11n). That's the behaviour we want in the product, even though it scores as a fail here.
- R05 cost $2.06 over 45 calls and still ended in needs-review. Sonnet solved it for $0.90.
- Fable 5.1 was not run, at the owner's call (10-17).

## Comparison

| | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| Base ladder L+R+H (26) | 24/26 | **26/26** | 25/26 |
| Hard H (10) | 9/10 | **10/10** | **10/10** |
| Vague + very vague (8) | 6/8 | 4/8 | **7/8** |
| Image items, with image (4)\* | 4/4 | 4/4 | 4/4 |
| **All 40** (incl. 2 no-image controls) | 34/40 | 34/40 | **36/40** |
| Mean $ per task | **$0.016** | $0.179 | $0.430 |
| Median $ per task | **$0.009** | $0.113 | $0.291 |
| Hard task mean $ | **$0.024** | $0.275 | $0.646 |
| Mean minutes, hard | 2.6 | **2.1** | 3.3 |
| Run total (40 tasks) | **$0.66** | $7.17 | $17.22 |

\* The M table counts 6 items; this row counts only the 4 with the image, since the no-image controls are expected to fail.

Earlier configurations on the same 26-item ladder: gpt-5-mini 24/26 at ≈ $0.04 per task; free mode with credit (Gemini Flash-Lite plus gpt-5-mini) 24/26 at ≈ $0.012 of credit; no-credit Gemini + Groq in progress, at $0.

Total spent on this evaluation: **≈ $25.2** of the $60 cap (platform ledger $2.42 → $27.62).

## What it means for a free plan on our key

The free plan allows 3 tasks a day. Per user, at full use, with these measured averages:

| Model on every role | Per task | 3 tasks/day, every day (30 days) | $0.20 trial covers | Pro's $3/month covers |
|---|---|---|---|---|
| Haiku 5.5 | $0.016 | ≈ $1.45 | ≈ 12 tasks | ≈ 185 tasks |
| Sonnet 5.5 | $0.18 | ≈ $16 | ≈ 1 task | ≈ 17 tasks |
| Opus 5.5 | $0.43 | ≈ $39 | 0 tasks (one hard task is ~$0.65) | ≈ 7 tasks |

**Recommendation.**

1. **Free plan and trial on Haiku 5.5.** At 1–2 cents a task it is at least as good as everything we measured before on easy, real-repo and hard work, and a maxed-out free user costs under $1.50 a month. The trial's $0.20 becomes ~12 tasks instead of 2, so `TRIAL_TASK_CAP_USD` and the "2 tasks" copy should change if the trial moves to Haiku.
2. **Pro and credit packs on Sonnet 5.5.** It's the only model that passed the whole ladder (incl. R05), and the fastest on hard items. $3 a month buys ~17 tasks, so Pro's included usage should either grow or route easy issues to Haiku.
3. **Opus 5.5 only for vague issues**, when the spec check flags the issue as unclear (7/8 vs 4/8). Escalating there costs ~$0.35–0.75 per vague task, against ~$0.13–0.26 on Sonnet.
4. **Prompting gap (all models):** vague-issue misses were confident wrong readings, not crashes, and models rarely asked. The intake should push harder to ask when the spec check finds open questions.

Caveats:
- One run per item.
- Our eval repos are small; on larger real repos expect the R-set costs (Haiku $0.04, Sonnet $0.34, Opus $0.75 mean).
- The simulated user is Haiku for every model.
- Effort `medium` throughout. `low` would be cheaper and is untested.
- Mixed routing (e.g. Sonnet planning + Haiku executing) is untested.

## Side effect found: one lifetime spend ledger for every platform key

`SPEND_HARD_STOP_USD` caps lifetime platform spend across **all** providers. It was sized for the OpenAI budget ($3). The Claude evaluation's $25.20 on the Anthropic key pushed the lifetime total to $27.62. After that, the no-credit campaign refused to start ("too close to the spend hard stop"), and every gateway reservation, even $0 Gemini calls, would have failed.

Stopgap (`backend/.env`, not committed): the hard stop is now $28.20, which keeps OpenAI's original $0.58 of headroom.

Proper fix (open): per-provider (per platform key) budgets in the spend ledger, so a test on one key can never block or loosen another.
