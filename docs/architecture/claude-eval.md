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
