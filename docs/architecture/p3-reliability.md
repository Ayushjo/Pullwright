# P3 — Park/resume, crash recovery, admission

_Started 2026-10-03. Live tests ran on a free lane profile (Gemini Flash-Lite plans and executes, Groq reviews)._

## Park and resume

When no model lane can take the next call (`NoLaneAvailable` with a retry time), the task **parks** instead of failing:

| Where it runs out | What is saved | How it resumes |
|---|---|---|
| Planning | workspace + plan message (already saved) | the planner runs again from the saved plan message (a few cheap calls) |
| Executing | the run conversation (`runMessages`) and the run's step / gate / review counters (`runUsed`) | the same conversation continues with one note; the step allowance is what was left, so waiting never buys extra steps |
| Review after a passing gate | as above | the agent is asked to call `finish` again: the gate re-runs (deterministic), then the review |

- **Scheduling:** a delayed BullMQ job at the retry time plus 0–2 min of random spread (so tasks parked on the same daily reset don't all wake at once), never sooner than 30 s.
- **Fencing:** the task stores the generation of the job allowed to resume it. A stale delayed job, or a second "Resume now", finds a different generation and does nothing; the parked → running switch is a compare-and-set, so it happens at most once.
- `retryAt = null` (no lane can serve without the user acting, e.g. no key) parks without a timer until **Resume now** (`POST /task/:id/resume`).
- **Expiry:** a task parked longer than `PW_MAX_PARK_HOURS` (48) ends as *needs review* if it has partial work, otherwise *failed*.
- **Cancel** works while parked; the pending resume then finds the task cancelled.
- **UI:** a "Paused" status, a banner with a countdown, **Resume now** and **Cancel**, and paused/resumed lines in the activity feed.
- **Eval runner:** waits through parks (not counted toward its 25-min limit) and records `parks` / `parkedMin` per row.

## Crash recovery

- **Every step persisted:** after each agent step (model reply plus all tool results) the conversation and counters are written with an "in flight" marker. A run that starts and finds the marker continues the saved conversation (with a note to re-check the files it was editing) instead of starting over. Edits can't be applied twice: `str_replace` / `apply_patch` need an exact match, so a repeated edit fails visibly.
- **Orphan sweeper** (at startup and every minute): an in-flight task (queued … publishing) with no stage lock, no queued or running job, and no update for 2 min gets the stage its status implies re-queued. Extra jobs are harmless (stage lock + status guard). A small index (`pw:inflight`) is maintained on every state write and backfilled at startup.
- **Parked-task sweeper:** a parked task whose resume time passed 5 min ago gets a fresh, fenced resume job.

## Live tests (10-03, all passing)

| Test | Result |
|---|---|
| Executor runs out of quota mid-run (both Flash-Lite lanes cooled down 90 s after 12 calls), H02 | parked at 13 calls → resumed by itself 2.5 min later → continued the same conversation (1 plan, no re-plan) → **ready, hidden test passes**, 28 calls |
| Planner runs out mid-plan, L04 | parked after 3 calls → resumed → planned → ran → **ready** |
| Fencing: parked with a 10-min wait, then "Resume now" clicked twice | **exactly 1 resume**; the second job logged "parked, not this job's turn"; the task finished ready |
| Cancel while parked | cancelled and removed from the parked index |
| `kill -9` of the backend mid-run, H02 (12 calls in) | after restart the job came back in ~90 s (dead worker's lock expiry), logged "worker restarted mid-run; continuing from the last saved step", **ready, hidden test passes**, 28 calls (same as uninterrupted) |
| `kill -9` exactly between "status → running" and queueing the run (H06) | **found a bug**: the task was stuck in "running" with no job. Fixed with the orphan sweeper; after restart it re-queued the run stage, and the task completed (H06 checks 7/7, reviewer flagged → needs review) |

## Admission (`src/entitlements/admission.ts`)

- **Limits:** free has 3 task starts per rolling 24 h and 1 active task (running *or* paused); Pro has 25 / 3. Env: `FREE_TASKS_PER_DAY`, `FREE_MAX_ACTIVE`, `PRO_TASKS_PER_DAY`, `PRO_MAX_ACTIVE`.
- **One Lua script** prunes the window, checks both limits and records the start. Redis test: 30 simultaneous submits with 1 slot admit exactly 1.
- **Errors:** `429 {code: "daily_limit", nextSlotAt}` with the time the oldest start leaves the window, or `429 {code: "active_limit"}`.
- **Active slots** are kept in step with every state write (`put` and `transition`). Waiting on the user (plan approval, a question, review) frees the slot; finished or expired tasks are pruned before each check.
- **Refunds:** a task that ends failed or cancelled before execution began (`runStarted`) gives its start back, as does a creation that throws after admission.
- `GET /api/capacity` returns tier, limit, used, left, next slot, active — for the "2 of 3 free tasks left today" meter.
- The operator and owner accounts bypass admission. A live 429 test needs a non-owner user with a key (P4 wallet); the logic is covered by the Redis tests.

## Free and paid queues

- Two BullMQ queues with their own worker slots (`WORKER_CONCURRENCY_FREE`, `WORKER_CONCURRENCY_PAID`), so free load can't delay paid work. BullMQ priorities can't preempt a running job; separate pools can.
- The class is fixed at creation: a Pro plan or the user's own key means paid. It's stored on the task, so resume and retry jobs go to the same pool. The free queue keeps the original name, so jobs queued before the split still run.
- **Live test:** 4 free tasks queued, then 1 paid. **The paid task left the queue after 0.0 s**; the free ones waited 17 / 31 / 65 s behind each other.

## Still open

- A longer repeated-kill stress run (one kill per test so far, plus the orphan case).
- Per-host exec semaphore for CPU-heavy tests (needed once a host runs several tasks at once).
