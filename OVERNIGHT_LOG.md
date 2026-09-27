# Overnight build log: Pullwright v2

Started: 2026-09-27 02:57 IST, from base commit `3a13f9d`.
Plan: `/Users/jochannnn/.claude/plans/okay-read-the-whole-zippy-breeze.md` (Phases 1→5).


## ☀️ Morning summary (read this first)

**Everything is on branch `pullwright-v2`** (not merged to main; nothing deployed). All 5 phases of the plan are built, tested in Chrome, and committed.

### What's new
1. **The agent core was rewritten** (`backend/src/agent/`):
   - one metered loop on gpt-5-mini, with edit tools that can't truncate or break files;
   - an aider-style repo map, and a grounding check that asks instead of inventing missing files;
   - a strict deterministic gate:
     - rejects empty or gutted diffs, deleted tests, and lockfile/dependency churn;
     - blocks unplanned files unless reverting them breaks the build;
     - bounces the finish once when a planned file was never touched;
     - checks route callers, and allows no new test failures;
   - an independent reviewer that checks every requirement, with one fix round.
2. **Jules-style UI** (task page):
   - approve or edit the plan and its requirements;
   - send notes mid-run and answer the agent's questions;
   - live diff with per-file include/exclude, checkpoints to restore, and a review report;
   - Publish PR (draft), Continue (+$0.10) when a run stops at its cap, and Share replay (`/r/:id`, public, no sign-in).
3. **Money:**
   - exact per-call ledger and per-task caps that scale with plan size;
   - global hard stop for your key;
   - bring-your-own-key (OpenAI and OpenRouter, encrypted);
   - Dodo Payments: checkout, customer portal, and signed webhooks;
   - Settings and Pricing pages.
4. **Security:**
   - the GitHub token never enters the sandbox, secrets are masked in events and logs, and job data holds no secrets;
   - OAuth `state` is checked, auth fails closed, and requests are rate limited;
   - the sandbox is non-root with a read-only root filesystem, no capabilities, pids/mem/cpu limits, and no network after dependency install.
5. **Infrastructure:**
   - the API and worker split through Redis pub/sub;
   - `deploy/ec2/setup.sh` sets up a capped EC2 worker with no inbound ports and optional gVisor;
   - a new DEPLOY.md, and CI covering backend and frontend.

### Results
- **Bookstore ladder, 11 levels: 11/11** on the final code, for $0.12 in total. The missing-file issue correctly stops to ask.
- **Real issues on this repo:**
  - #13 (Home.tsx tagline): ✅
  - #1 (health endpoint): ✅
  - #2 (pagination): ✅ on acceptance, but correctly sent to `needs_review` because the reviewer found a DB-branch gap
  - #4 (search + stats, 5 files): ✅ for $0.047
  - #7 ([HARD], 9 files): partial. See the final entry in the table.
- **Real end-to-end run through the UI:** devin-test-app #3 → **draft PR https://github.com/Ayushjo/devin-test-app/pull/4**, $0.047 including two rounds of human feedback.

### Needs you (I couldn't / shouldn't do these)
- **Merge** `pullwright-v2` → main after a look (`git log main..pullwright-v2`).
- **Railway API env:** `WORKER_MODE=api`, `OPERATOR_GITHUB_LOGINS=Ayushjo`, `TASKS_PER_HOUR`, `MAX_ACTIVE_TASKS_PER_USER`. Make sure `SESSION_SECRET` is set.
- **Dodo:**
  - create the Pro product;
  - set `DODO_API_KEY`, `DODO_PRO_PRODUCT_ID`, `DODO_WEBHOOK_SECRET`, `DODO_ENV`;
  - point the webhook at `https://api.<domain>/api/webhooks/dodo`.
- **EC2 worker:** run `deploy/ec2/setup.sh`, then fill in `/etc/pullwright/worker.env`. It needs the same `SESSION_SECRET` and the public Redis URL.
- **Local sign-in:** the GitHub OAuth app's callback points at production. For local UI testing I added a dev-only login (`ENABLE_DEV_LOGIN=1`, loopback only, never in prod).
- **Record the demo:** see `docs/DEMO.md`. Until `frontend/public/demo.mp4` exists, the landing page links the public replay of the PR #4 run.
- **Security cleanup:** old BullMQ jobs from the previous app (queue `tasks`) may still hold plaintext GitHub tokens in Railway Redis. When convenient, clear them (e.g. `new Queue('tasks').obliterate({force:true})`), or rotate the tokens.
- **Stop the scheduled resume task** "Pullwright overnight resume" in the sidebar; it only runs if this session went idle.

### Known limits
- Very large multi-file issues (8+ files including big UI components) may still end in `needs_review`. The model tends to skip the biggest UI step. The gate now bounces planned-but-untouched files, and the Continue button can extend the budget, but these still need a human look.
- The frontend has no automated UI tests; it was verified manually in Chrome.

## Hard rules (from the owner)
- **OpenAI spend over the whole night: at most $2.00.** The ledger is `backend/.spend/openai-ledger.jsonl` (one line per call: model, tokens, cost). The code hard-stops at $1.80. No other paid APIs.
- Don't ask the owner anything; pick the best option and log why.
- Frontend changes must keep the current visual style: light mode, Plus Jakarta Sans, accent #2b7fff.
- Test ladder: 10–12 issues of rising difficulty on `Ayushjo/devin-test-app`. Fix → retest → harder.

## Environment notes
- Docker CLI: `/Applications/Docker.app/Contents/Resources/bin/docker`. The `/usr/local/bin` symlink points to an unmounted DMG.
- Redis is on Railway (`REDIS_URL`), Postgres on Neon. The OpenAI key is valid.
- The reference repos are in `references/` (git-ignored locally).

## Heartbeat
last-active: 2026-09-27 06:36 IST

## Progress
- [x] Phase 1: agent core. The bookstore ladder passes 11/11, and real-repo issues #13, #1 and #2 pass (see the table).
- [x] Phase 2: security + infra (token vault, masking, fail-closed auth, OAuth state, rate limits, helmet, sandbox hardening, Redis spend counters, API/worker split, EC2 deploy)
- [x] Phase 3: Jules flow UI/API. Tested end to end in Chrome: plan approval with edited steps/requirements, notes during a run, ask_user round trip, reviewer fix round, live diff, per-file review, Publish PR → https://github.com/Ayushjo/devin-test-app/pull/4 (draft)
- [x] Phase 4: BYOK + Dodo. `api_keys` table (AES-GCM), key validation via the provider's models endpoint (no spend), entitlements (Free = own key only, the platform key is never used; Pro = $3 included), Dodo checkout, customer portal, and Standard Webhooks verification with idempotency. Settings and Pricing pages checked in Chrome; a fake key was rejected correctly. **Needs you:** create the Pro product in Dodo and set DODO_API_KEY / DODO_PRO_PRODUCT_ID / DODO_WEBHOOK_SECRET / DODO_ENV. Webhook URL: `https://api.<domain>/api/webhooks/dodo`
- [x] Phase 5: demo/landing. Landing copy matches the real flow, the showcase card uses the actual PR #4 run, the demo section auto-detects `public/demo.mp4` and otherwise links the public replay, footer links work, and `docs/DEMO.md` has the shot list.

## Test runs
All runs are local eval tasks (fixture `backend/evals/fixtures/bookstore`, hidden acceptance tests, never published). Models: gpt-5-mini for plan and run (reasoning effort low); judge was gpt-5-nano, then gpt-5-mini from run 13.

| # | Issue | Level | Result | Accept test | Judge | Cost $ | Notes |
|---|---|---|---|---|---|---|---|
| 1 | L01 add `start` script | 1 | ready | pass | ✔ high | 0.0043 | package.json +1 |
| 2 | L02 divide by zero | 2 | ready | pass | ✔ high | 0.0041 | math.js +1 |
| 3 | L03 slugify dashes and accents, with tests | 3 | ready | pass | ✔ high | 0.0098 | also added tests |
| 4 | L04 Inventory.remove guards | 4 | ready | pass | ✔ high | 0.0077 | **Scope creep: also "fixed" math.js.** Fixed by prompt scope rule, a gate rule on unplanned files, and a stricter judge |
| 5 | L04 (rerun) | 4 | ready | pass | ✔ high | 0.0048 | only inventory.js now |
| 6 | L05 discount before tax | 5 | ready | pass | ✔ high | 0.0045 | |
| 7 | L06 GET /books filters, with tests | 6 | ready | pass | ✔ high | 0.0141 | |
| 8 | L07 quote validation → 400 | 7 | ready | pass | ✔ high | 0.0124 | |
| 9 | L08 low-stock section in a 402-line file | 8 | ready | pass | ✔ high | 0.0085 | +15/-0; no truncation |
| 10 | L09 issue references non-existent auth.js and RateLimiter | 9 | ready | n/a | ✔ | 0.0118 | **Invented both files.** Fixed by a deterministic grounding check plus a planner rule |
| 11 | L10 pagination | 10 | needs_review | pass | ✘ | 0.0066 | **Judge false negative** (nano misread URLSearchParams). Judge moved to gpt-5-mini and given test evidence |
| 12 | L11 report endpoint (raw text bodies) | 11 | ready | pass | ✔ high | 0.0139 | cross-cutting server change |
| 13 | L09 (rerun) | 9 | failed = correct | n/a | – | 0.0037 | "Needs clarification: repo does not contain src/middleware/auth.js…" |
| 14 | L10 (rerun) | 10 | ready | pass | ✔ high | 0.0068 | |
| 15 | R01 real repo #13: Home.tsx tagline | 12 | needs_review | fail | ✘ | 0.0238 | **Platform bugs:** tests wrote the tracked `app.log`; the gate asked the agent to revert it, so it deleted the file. The baseline ran with network but validation didn't (`EAI_AGAIN localhost`). Fixes: auto-revert artefact side effects, run the baseline in the same no-network container, and drop `NetworkDisabled` (it removed /etc/hosts) |
| 16 | R01 (rerun) | 12 | ready | pass | ✔ high | 0.0065 | +1/-0 on a 486-line TSX file (the old agent deleted 344 lines here) |
| 17 | R02 real repo #1: /api/health, no auth | 13 | ready | pass | ✔ high | 0.0102 | registered before requireAuth, correctly |
| 18 | R03 real repo #2: tasks pagination | 14 | ready | pass | ✔ | 0.0249 | **Missed "update internal usage" (frontend) and the DB branch; the judge didn't notice.** Added a requirements checklist (planner extracts requirements → finish must account for each → judge checks each), a caller-search rule, and a judge fix round |
| 19 | R03 (rerun) | 14 | failed | – | – | 0.0138 | planner hit 14 steps; 3 were wasted on regex errors from `list(` |
| 20 | R03 (rerun) | 14 | ready | pass | ✔ high 8/8 requirements | 0.0425 | search falls back to literal on bad regex; plan limit is now 20. DB and Redis paths plus the frontend client were updated |
| 21 | **Real UI run** devin-test-app #3 `modulo()` via Chrome | – | published | manual ✔ | ✔ high | 0.0470 | Planner wanted to also fix divide (scope creep); **edited out in the approval UI**. Agent then deleted the failing divide test to get green; **the reviewer caught it**. I asked for changes in the UI and it restored the test. Bugs found and fixed: live counters raced status writes (lost `needs_input`), stale plan summary misled the judge, repeated ask_user, no gate rule against deleting tests, PR body showed stale risks. PR #4 opened as a draft |

### Regression pass on the final code
Full ladder rerun after all fixes: **L01–L11: 11/11** (L09 correctly blocked) for $0.12 total. **R01, R02 pass.**
R03 at first skipped the frontend callers again (the reviewer couldn't see them). Added a deterministic **route-consumer impact analysis** to the gate. On the rerun it updated `frontend/src/api/client.ts` and passed acceptance, but was left in `needs_review` because the reviewer correctly found the DB branch ignores offset/status. That is the intended strict behavior: a human reviews it instead of a bad PR being opened.


### Hard real-repo issues (after the regression pass)
| Run | Issue | Result | Cost | What it taught / changed |
|---|---|---|---|---|
| R04 | #4 search + aggregate stats (5 files, backend + frontend) | ✅ ready, acceptance pass, reviewer ✔ | $0.047 | The old agent produced an empty PR (#6) and stubs (#10) for this |
| R05a | #7 [HARD] cancellation + run history (9–11 files) | partial | $0.060 | Hit the 40-step limit → **adaptive step budget** (25 + 8/file) and **parallel read calls** |
| R05b | same | partial | $0.091 | My unplanned-file rule forced reverts of needed type plumbing → **revert-and-rebuild probe** (keeps needed edits, still catches scope creep; L04 rechecked ✅) |
| R05c | same | partial | $0.131 | Stopped by the $0.15 cap → **cap scales with plan size** and a **Continue (+$0.10)** button |
| R05d | same | partial | $0.126 | Skipped the UI step → **plan-completion check** (planned-but-untouched files bounce the finish once) |
| R05e | same | partial → continued | $0.121 + $0.053 | Hit 80 steps → Continue now works for any early stop; after Continue it added the TaskView cancel button (Run History still missing). The reviewer's JSON was truncated → **JSON mode and compact reviewer schema** (L02 rechecked ✅) |

**Honest assessment:** issues touching up to about 5 files across backend and frontend land cleanly for $0.005–$0.05. Very large issues (9+ files, including big React components) end in `needs_review` with most of the work done and clearly marked gaps, never as a broken PR.

## Spend total
**$1.166** of the $2.00 allowance (Redis counter for the platform key; every call is in `backend/.spend/openai-ledger.jsonl`). Evals stopped here on purpose.

ALL DONE — later scheduled sessions should do nothing.