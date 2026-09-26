# Deploying Pullwright

```
Browser ──HTTPS/SSE──▶ API  (Railway, WORKER_MODE=api)  ──┐
                          │                               │ Redis (Railway): job queue, events pub/sub, spend counters
                          └── Postgres (Neon) ◀───────────┤
                                                          │
                       Worker (AWS EC2, WORKER_MODE=worker) ◀┘  clones repos, runs sandboxes (Docker), opens PRs
```

The API never touches Docker, and the worker never accepts inbound traffic. They talk only through Redis and Postgres.

## 1. Neon (Postgres)
1. Create a project and copy the pooled `DATABASE_URL` and the direct `DIRECT_URL`.
2. Migrations run automatically when the API starts (`prisma migrate deploy`).

## 2. Railway: Redis + API + Frontend

| Service | Root dir | Notes |
|---|---|---|
| Redis | plugin | The API uses the private URL. The EC2 worker needs the **public** URL (Connect → Public). |
| API | `backend` | Dockerfile build; health check `/health`. |
| Frontend | `frontend` | Dockerfile build; set the `VITE_API_URL=https://api.<your-domain>` build arg. |

API variables:

```
NODE_ENV=production
WORKER_MODE=api
REDIS_URL=${{Redis.REDIS_PRIVATE_URL}}
DATABASE_URL=...            DIRECT_URL=...
SESSION_SECRET=<64 random hex chars, same on the worker>
GITHUB_CLIENT_ID=...        GITHUB_CLIENT_SECRET=...
FRONTEND_URL=https://pullwright.<your-domain>
BACKEND_URL=https://api.pullwright.<your-domain>
TASKS_PER_HOUR=12           MAX_ACTIVE_TASKS_PER_USER=1
OPERATOR_GITHUB_LOGINS=Ayushjo   # owners run on the platform key (still capped by SPEND_HARD_STOP_USD on the worker)
DODO_API_KEY=...            DODO_WEBHOOK_SECRET=...   DODO_PRO_PRODUCT_ID=...   DODO_ENV=live_mode
```

GitHub OAuth app callback URL: `https://api.pullwright.<your-domain>/api/auth/github/callback`.

## 3. AWS EC2 worker
- **Instance:** Ubuntu 24.04, `t4g.small` (ARM) or `t3.small`, 30 GB gp3. A Spot instance works well because tasks are short and retryable.
- **Security group:** no inbound rules. Use SSM Session Manager or SSH from your IP only.

```bash
curl -fsSL https://raw.githubusercontent.com/Ayushjo/MyOwnDevin/main/deploy/ec2/setup.sh | sudo bash
sudo nano /etc/pullwright/worker.env          # see deploy/ec2/worker.env.example
sudo systemctl enable --now pullwright-worker
journalctl -u pullwright-worker -f
```

Caps, applied in layers:
1. **systemd:** the worker process gets `MemoryMax=700M`, `CPUQuota=100%`, and no new privileges.
2. **Each sandbox container:** 1 CPU, 1.2 GB RAM (2 GB during dependency install), 256 pids, read-only root filesystem, all capabilities dropped, non-root user, and no network after setup.
3. **Each task:** one task at a time (`WORKER_CONCURRENCY=1`), $0.15 spend cap, and time limits of 8 min for planning and 18 min for implementation.

To harden further with gVisor:

```bash
sudo apt install -y runsc && sudo runsc install && sudo systemctl restart docker
echo SANDBOX_RUNTIME=runsc | sudo tee -a /etc/pullwright/worker.env && sudo systemctl restart pullwright-worker
```

## 4. Local development
```bash
cd backend && npm ci && npx prisma migrate deploy && npm run dev   # WORKER_MODE=both, needs Docker Desktop
cd frontend && npm ci && npm run dev                               # http://localhost:5173 (proxies /api)
```

Evals (run locally; never publish anything):

```bash
cd backend && npm run eval -- L01 L05 R01
```

Results are written to `backend/.spend/eval-results.jsonl`. Every model call is recorded in `backend/.spend/openai-ledger.jsonl`.
