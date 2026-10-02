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
| Groq gpt-oss-120b (free) | _running_ (21/60 so far: FA 1/6, FR 1/15, 7 too large for 8K, 2 JSON failures) | | | $0 | 57 s incl. waiting |
| Groq qwen3.8-27b (free) | _queued_ | | | | |

**Findings so far**
- **Flash-Lite is disqualified as reviewer**: it approves almost anything (8 of 11 bad patches, including an H03 run with 6 failing tests). Cheap and fast, but it does not catch errors.
- **Groq's real limit for reviews is tokens per minute, not requests per day.** Its free tier allows 8K tokens/min; a review prompt is 5–7K, so the gateway paces it to about **one review per minute**. Fine for one task; a problem for several at once.
- **gpt-5-mini is a strict reviewer**: 5 of 49 good patches rejected (they then go through a fix round, which costs calls but not correctness) and only the two H01 cases approved wrongly.
- **Groq gpt-oss-120b can't review large-repo patches**: 7 of its first 28 inputs (every H07 and some H06/H08, the MyOwnDevin fixture) exceed the 8K request cap, and it failed JSON mode twice. It fits the small fixture only.
- The hard cases are the three **H01 (persistence) patches**: they look complete, match the plan, but fail the hidden test because the spec wanted a synchronous store and the agent chose async. Even gpt-5-mini approved 2 of 3. No reviewer can see a hidden spec; this is the intake problem (settle sync/async from the code's conventions), which P1.5 now addresses.

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

## 4. Open steps

- [ ] free-mode campaign over the full ladder (`lanes/free.env`, `--campaign --tag free-v1`)
- [ ] 2 more gpt-5-mini runs each of H04 and H10 (the P1 cost question)
- [ ] gpt-5.4-nano on the full ladder
- [ ] vague set end to end with `--simulated-user`
