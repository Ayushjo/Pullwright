# Credits: Pro usage, packs and the free trial

Status: built 2026-10-08 (test mode). Migration `20261008000000_credit_ledger` was applied to Neon with
`prisma migrate deploy`. It is purely additive: one table, one enum, one nullable column.

## Why

Before this change, a user without a working key had two options: subscribe to Pro or leave.
Credits add two more:

- **Trial:** see one real PR before doing anything.
- **Credit pack:** pay once, with no subscription.

Pro's included $3 also moved onto the same ledger, so all three are counted in one place.

## Model

All amounts are stored in micro-USD (`BigInt`); 1 USD = 1,000,000. Each movement is one row in
`credit_ledger`:

| kind     | amount | expires              | `external_ref` (unique)            | from                                   |
|----------|--------|----------------------|------------------------------------|----------------------------------------|
| grant    | +$3    | end of billing period| `pro:<subscription>:<period end>`  | `getEntitlement` (lazily, once/period) |
| purchase | +$4.25 | 365 days             | `pay:<dodo payment id>`            | `payment.succeeded` webhook or sync    |
| trial    | +$0.20 | 14 days              | `trial:gh:<github id>`             | `POST /api/credits/trial`              |
| debit    | −spend | —                    | — (unique `task_id`)               | `makeStatusSink`, credit tasks only    |
| refund / adjust | ± | optional           | caller-chosen                      | manual                                 |

**Balance** (`computeBalance`, a pure function):

- Rows are replayed in time order.
- Each debit consumes credit that was live at the debit's time, earliest expiry first. Credit that never
  expires is consumed last.
- Credit that expires simply stops counting.
- A debit that finds nothing left to consume is reported as an overdraft; it is never hidden.

**Available** = balance − (cap − spent) for every credit-funded task that can still spend
(queued … publishing, parked).

## Who pays for a task (`getEntitlement`)

1. **Wallet.** If the user's own keys can plan and run, the task runs on them, free keys first. Credit is
   untouched.
2. **Credits.** If available ≥ $0.02, the task runs on our platform lanes with
   `fundedBy: "credits"` and `capUsd = min($0.30, available, $0.10 if every live bucket is trial)`.
3. **Legacy own OpenAI/OpenRouter key.** Bounded by the monthly run count.
4. **Nothing.** Return 402 `needs_key_or_plan`; the UI then offers the trial.

Credit tasks use the paid queue, except trial-only tasks, which queue with free work.

## Safety rules (and where they're enforced)

- **Only tasks created with `options.fundedBy === "credits"` are ever debited.** Owner, operator and eval
  tasks also run on platform lanes and never touch a ledger. Enforced in `makeStatusSink`; tested in
  `agent/__tests__/creditDebit.test.ts`.
- **No double credit.**
  - Every grant has a unique `external_ref`.
  - A webhook retry under a new webhook id, or a return-page sync after the webhook, returns
    "duplicate" and changes nothing.
  - Tested in `billing/__tests__/handleWebhook.test.ts`.
- **No double spend of the same dollars.** `/task` re-reads the balance under the per-user admission
  lock. `createTask` writes the task row, with its options and cap, before the lock is released, so the
  next submit sees the reservation.
- **Extending a run** (`/task/:id/extend`) on a credit task requires `available ≥ addUsd`.
- **Trial abuse limits**, all server-side (`billing/trial.ts`):
  - one trial per GitHub account;
  - the GitHub account must be at least 30 days old (`created_at` is fetched once with the user's token
    and stored in `users.github_created_at`);
  - at most `TRIAL_DAILY_MAX` (3) trials a day across everyone. The count and the grant run under a
    Postgres advisory transaction lock;
  - a kill switch, `TRIAL_ENABLED=0`.

  The worst case is 3 × $0.20 = $0.60 a day.
- **A pack never touches the subscription.** `payment.succeeded` with a subscription id is ignored, and
  so is a cart without the pack product or a payment whose `metadata.user_id` isn't a known user.

### Bug found on the way

`createTask` copied only a few options. `allowTraining` (private-repo consent), `transport` and
`specCheck` were silently dropped, and `fundedBy` and `capUsd` would have been too.

- **Effect:** a private-repo task whose owner had consented still had training keys filtered out.
- **Fix:** it now copies all of these, and the DB row stores options from creation.

## Configuration

| env | default | meaning |
|-----|---------|---------|
| `DODO_PACK_PRODUCT_ID` | — | one-time product (`scripts/pw/dodo-setup.mts pack`); test: `pdt_0NpHUrg4eSdzgZBPFKMIe` |
| `PACK_PRICE_USD` / `PACK_CREDIT_USD` / `PACK_VALID_DAYS` | 5 / 4.25 / 365 | price shown, credit granted, validity |
| `MIN_CREDIT_TASK_USD` / `CREDIT_TASK_CAP_USD` / `TRIAL_TASK_CAP_USD` | 0.02 / 0.30 / 0.10 | start threshold and per-task caps |
| `TRIAL_USD` / `TRIAL_VALID_DAYS` / `TRIAL_MIN_ACCOUNT_DAYS` / `TRIAL_DAILY_MAX` / `TRIAL_ENABLED` | 0.2 / 14 / 30 / 3 / on | trial |

The webhook must also subscribe to `payment.succeeded` (`dodo-setup.mts webhook` now includes it). Until a
deployed HTTPS backend exists, the return page confirms purchases through `POST /api/billing/sync`.

## API

- `GET /api/credits` returns `{summary, history, trial: {available, claimed, usd}, pack: {enabled, priceUsd, creditUsd, validDays}}`.
- `POST /api/credits/trial` returns `{ok, usd, expiresAt, summary}`. On refusal it returns 409, or 429 for
  `sold_out_today`, with one of these codes: `already_claimed`, `account_too_new`, `unknown_age`,
  `disabled`.
- `POST /api/billing/checkout {kind: "pro" | "pack"}`.
- `POST /api/billing/sync` now also returns `credited`/`succeeded` for a pack.

## UI

- **Settings → Credits:**
  - balance, with the amount held for running tasks;
  - next expiry;
  - the last 8 ledger rows (debits link to their task);
  - *Try 2 tasks free* and *Buy $4.25 credit — $5.00* buttons.
- **New task:** on 402, it offers the trial inline. That claims the trial and starts the task.
- **Pricing:**
  - credit pack in Pro's features and the compare table;
  - two FAQ entries (trial, pay as you go).

## Tests

- `credits.test.ts` (6): balance arithmetic, expiry order, expired credit, no back-dated consumption,
  splits, micro-dollar exactness.
- `handleWebhook.test.ts` (+2): a pack is credited once across webhook ids; non-pack and unknown-user
  payments are ignored; a pack never creates a subscription.
- `trial.test.ts` (5): once per GitHub id across Pullwright accounts, account age, age stored once, daily
  cap and reset at UTC midnight, kill switch.
- `creditDebit.test.ts` (3): only credit tasks are debited; `createTask` keeps funding, cap and consent.

## Not done yet

- End-to-end in test mode: buy a pack through Dodo checkout, claim the trial, run a credit task, and watch
  the debit. This is waiting for the free-nocredit campaign to finish so the backend can restart on the
  new code.
- A deployed webhook endpoint (EC2) and live-mode products.
- Refunds through Dodo (`refund.succeeded` → a negative `adjust` row removing the refunded credit) once live.
