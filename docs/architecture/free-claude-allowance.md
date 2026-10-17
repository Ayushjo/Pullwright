# Free monthly Claude allowance (10-17)

**Goal:** a new user signs in and runs a real task straight away, with no key and no card. The operator funds this from the Anthropic promo credits ($100 a month).

**Model:** Haiku 5.5 (`claude-eval.md`). It scored 34/40 hidden tests at **$0.016 a task**, which is as good as or better than every earlier free configuration on the base ladder.

## Budget

| | |
|---|---|
| Promo credits | $100 / month |
| Pool budget (20% buffer) | **$80 / month**, **$2.70 / UTC day** |
| Per-task hard cap | $0.15 (measured mean $0.016, worst case $0.12) |
| Allowance | **10 tasks per user per UTC month**, renewing on the 1st |
| Capacity at the measured mean | ≈ 5,000 tasks a month, ≈ 170 a day |
| Worst case (every task hits its cap) | 533 tasks a month, 18 a day; the pool caps hold either way |

## How it works

1. **Budgeted pool** (`agent/spend.ts`):
   - `ANTHROPIC_POOL_MONTHLY_USD` and `ANTHROPIC_POOL_DAILY_USD` make every platform lane on the Anthropic key a `pool` lane (`llm/lanes.ts`).
   - Pool calls reserve their worst case atomically. They reuse the same Lua script as platform spend, with the pool's UTC-day counter in the lifetime slot and the UTC-month counter in the month slot.
   - Pool spend never counts toward `SPEND_HARD_STOP_USD`, the OpenAI-sized lifetime stop. This fixes the shared-ledger problem found in the Claude evaluation.
   - Counters are seeded from `llm_calls` rows with `key_owner = 'pool'`.
2. **Exhausted pool = exhausted quota** (`llm/gateway.ts`):
   - A `SpendLimitError` with scope `pool` carries `retryAt` (next UTC midnight, or the 1st of next month).
   - The gateway tries the next lane; with none left it raises `NoLaneAvailable(retryAt)`. A task that runs out mid-way **parks** and resumes when the pool refills instead of failing.
3. **The allowance** (`billing/freeAllowance.ts`):
   - It's counted in tasks: tasks this UTC month with `options.fundedBy = "free_claude"`. One cancelled before it spent anything doesn't count.
   - Eligibility: the feature is on, the pool and key are configured, and the GitHub account is ≥ 30 days old. The account's `created_at` is now stored at every sign-in.
   - Availability: the user has tasks left **and** the pool has room for one more capped task today and this month.
4. **Who pays** (`billing/index.ts` `getEntitlement`):
   1. the user's wallet keys (free keys first);
   2. **the free Claude allowance**;
   3. credits (Pro's monthly usage, packs);
   4. the legacy own key;
   5. otherwise 402 with a clear reason: used up (renews on the 1st), pool closed until HH:MM UTC, or account too new. Each reason also suggests a free Gemini key for unlimited free tasks.
5. **Routing by who pays** (`agent/pipeline.ts` `fundedLanes`), for every role including vision:
   - `free_claude` → `anthropic:FREE_CLAUDE_MODEL` (Haiku 5.5), pool spend class.
   - `credits` → `PW_LANES_CREDITS` (Sonnet 5.5, 26/26 on the ladder), with the new **`credits` spend class**, bounded only by the task cap. The task cap is already at most the user's balance, so paying users never wait on the free pool's daily budget.
6. **Admission** (`api/router.ts`):
   - The allowance is re-counted under the per-user admission lock, so two quick submits can't both take the last task.
   - Free tasks queue with free work.
   - `/extend` is refused for free tasks (402 `free_task_cap`): more budget comes from a key or credits, not the pool.
7. **UI:**
   - `FreeClaudeMeter`: "7 of 10 free Claude tasks left this month · No key needed · renews Nov 1", with amber states for used up, pool closed until HH:MM, and account too new. It appears in Settings → Plan & usage and on New task when the allowance will run the task.
   - Pricing: "10 tasks a month on Claude, no key needed" and "Unlimited with a free Gemini key"; Pro is $3 of Sonnet a month (≈ 15 tasks); the FAQ is updated.
8. **The one-time $0.20 trial** is turned off (`TRIAL_ENABLED=0`); the monthly allowance replaces it. The code stays.

Private repos need no training-consent prompt on this path: the Anthropic API doesn't train on inputs.

## Configuration (`backend/.env.example`)

`ANTHROPIC_POOL_MONTHLY_USD=80`, `ANTHROPIC_POOL_DAILY_USD=2.70`, `FREE_CLAUDE_TASKS_PER_MONTH=10`, `FREE_CLAUDE_TASK_CAP_USD=0.15`, `FREE_CLAUDE_MIN_ACCOUNT_DAYS=30`, `FREE_CLAUDE_MODEL=claude-haiku-5-5`, `FREE_CLAUDE_ENABLED=1` (kill switch), `PW_LANES_CREDITS=anthropic:claude-sonnet-5-5`, `TRIAL_ENABLED=0`.

## Tests

- `spend.test.ts` (+3, real Redis):
  - the daily budget is enforced with a refill time at the next UTC midnight;
  - pool spend never touches the platform hard stop;
  - calls in flight count, so parallel calls can't overshoot;
  - the monthly budget is enforced.
- `freeAllowance.test.ts` (5):
  - N tasks a month, renewing on the 1st;
  - stops at the limit;
  - account age (too new, unknown);
  - the pool closes for the day and for the month, with the reopen time;
  - the kill switch and an unconfigured pool turn it off.
- `poolLanes.test.ts`: lanes on a budgeted key are `pool` lanes.

## Open

- Promo-credit terms: confirm the credits may serve end users, and when unused credit expires.

## End-to-end GUI run (10-17, Brave, owner signed in as a normal user, wallet keys paused then restored)

| Step | Result |
|---|---|
| Settings with no usable key | entitlement `fundedBy: free_claude`, Haiku 5.5, $0.15 cap; meter "10 of 10 free Claude tasks left this month · No key needed · renews 1 Nov"; "New tasks run free on Claude Haiku 5.5 — no key needed" |
| New task page | daily capacity meter plus the free-Claude meter |
| Start `Ayushjo/devin-test-app#1` | ready, tests and reviewer green, **6 calls, $0.0022**, every call `anthropic/claude-haiku-5-5` with spend class `pool`; pool counters day and month = $0.00224 exactly |
| Afterwards | meter **9 of 10**; credit balance unchanged ($7.444049), no debit row |
| Allowance set to 1 (used up) | meter turns amber ("They renew 1 Nov. A free Gemini key gives you unlimited free tasks" + link); new tasks fall through to **credits** (Sonnet, $0.30 cap), as designed for a user who has credit |

- **Queue:** the free task went to the paid queue because the test account is Pro (`tier === "pro"`), which is the intended policy. A free account's allowance tasks queue as free.
- **Copy fixes from the run:** singular copy for a one-task allowance, and the model shown as "Haiku 5.5".

## Spend alerts and the owner's pool page (10-17)

**Thresholds** (`SpendLedger.checkPoolAlerts`): after every recorded pool call, alerts fire at **70%, 90% and 100% of the month**, and **"today full"** when the day can't fit one more capped free task. Each fires **once per period**: a Redis `SET NX` on `pw:alert:pool:<pool>:<period>:<scope>:<pct>`, so it can't repeat or race across workers. Levels: warn (70%) and critical (≥ 90%, and day full).

**Where alerts go:**
- the server log (`[pool alert] …`);
- the owner's alert list (`pw:alerts:pool`, latest 100);
- optionally `POOL_ALERT_WEBHOOK_URL`, a Slack or Discord incoming webhook (posts `{text, content}`). It's off until the owner sets it.

**API:** `GET /api/admin/pool`, open to the owner (`OPERATOR_GITHUB_LOGINS`) or the operator token. It returns budget, month and today spend, month-end projection, thresholds, free tasks this month (count, users, average cost) and recent alerts. `/api/auth/me` now carries `isOwner`.

**UI:**
- **Free pool** page (`/admin/pool`, **Pool** in the nav for owners only):
  - month card: big number, a bar with 70% and 90% marks that turns amber then red, and a projection line that turns amber or red when the pace would overshoot;
  - today card;
  - free-tasks card (count, users, average per task, allowance, model);
  - alert timeline, with the webhook on or off;
  - refreshes every 30 s.
- **Dashboard banner** for owners past 70% (amber; red past 90%) or when today is full, linking to the pool page.

**Tests:** `spend.test.ts` (+2) checks that 70% and 90% each fire once with the notifier called, that a third call adds nothing, and that "full for today" fires once.

**Live check:** with the budget temporarily at $0.003, the real $0.0022 spent was 75%. The real check fired the 70% alert once, the page showed an amber bar, the badge "Past 70%", a red projection (144%) and the alert row, and the dashboard banner appeared. The budget was then restored to $80 and the test alert deleted.
