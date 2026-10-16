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
- Alerts at 70% and 90% of the monthly pool (today it shows only in `/api/budget`-style reads).
- An end-to-end GUI run (below, 10-17).
