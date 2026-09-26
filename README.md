# Pullwright: GitHub issue → reviewed pull request

Paste a GitHub issue. **Approve the plan, watch it work in a sandbox, review the diff, then ship the PR.**
Every change passes a deterministic validation gate and an independent AI review before you ever see it. Every model call is metered and hard-capped.

- **Plan you control:** a ranked map of the repo, a short plan, and an explicit requirements checklist. You approve, edit or cancel before anything runs.
- **Strict execution:** targeted edits (`apply_patch` / exact `str_replace`, never whole-file rewrites) that are syntax-checked and reverted if they break the file. The repo's own tests and type-checks run in a sandbox with no network access.
- **Validation gate (no LLM):** rejects empty or whitespace-only diffs, gutted files, deleted tests, lockfile/artefact/dependency churn, unplanned files, new syntax errors, and tests that passed before but fail now.
- **Independent reviewer:** checks each requirement against the patch and can send the agent back once to fix problems.
- **You ship it:** per-file include/exclude, checkpoints you can restore, mid-run notes, follow-up change requests. The draft PR opens only when you click.
- **Cheap by design:** gpt-5-mini with cached prompts. Most tasks cost $0.004–$0.04, every task has a hard cap, and there is a global kill-switch for the operator key. Users can bring their own OpenAI or OpenRouter key.

## Architecture

```
Browser (React 19 + Vite)  ──HTTPS/SSE──▶  API (Express, WORKER_MODE=api)
                                            │  auth · tasks · approvals · billing webhooks · SSE fan-out
                                            │  Postgres (Neon): users, tasks, events, keys, subscriptions
                                            │  Redis: BullMQ jobs {taskId} · pub/sub events · spend counters
                                            ▼
                       Worker (EC2, WORKER_MODE=worker, one task at a time)
  prepare   clone on the host (token via GIT_CONFIG env, never stored) → install deps (network on) → baseline tests
  plan      read-only sandbox · repo map + AGENTS.md + grounding check → submit_plan (requirements, steps, files)
  run       no-network sandbox · agent loop (edit tools, shell, update_plan, ask_user, finish) · stuck detector
  validate  gate (diff/tests/syntax/scope) → reviewer (requirements) → one fix round
  publish   on your click: fresh clone → apply the accepted patch → commit → push → draft PR
```

The agent core (`backend/src/agent/`) borrows the best ideas from open-source agents:

- Codex's `apply_patch` format and fuzzy matching
- SWE-agent's lint-guarded edits and observation trimming
- aider's PageRank repo map
- mini-swe-agent's minimal, cost-capped loop
- OpenHands' two-phase publish, stuck detection and event model
- Cline's checkpoints and plan mode
- Plandex's per-file review

## Evals

```bash
cd backend && npm run eval            # all ladder items (local fixtures, never publishes)
cd backend && npm run eval -- L08 R03 # selected items
```

`backend/evals/ladder.json` defines 14 issues of increasing difficulty (from a one-line `package.json` fix up to multi-file TypeScript changes on this repo) with hidden acceptance tests. Results go to `backend/.spend/eval-results.jsonl`, and every model call is recorded in `backend/.spend/openai-ledger.jsonl`. See `OVERNIGHT_LOG.md` for the first full run and what each failure taught us.

## Run locally
```bash
cd backend && npm ci && npx prisma migrate deploy && npm run dev   # needs Docker Desktop, Redis, Postgres
cd frontend && npm ci && npm run dev -- --port 5174
```

For local UI sign-in without an OAuth app pointing at localhost, set `ENABLE_DEV_LOGIN=1` (never in production) and open `/api/auth/dev-login`.

Deployment (Railway API + Neon + an EC2 worker) is covered in [DEPLOY.md](DEPLOY.md), and recording the demo in [docs/DEMO.md](docs/DEMO.md).

MIT license.
