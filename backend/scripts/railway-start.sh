#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${DATABASE_URL:-}" && "${WORKER_MODE:-api}" != "worker" ]]; then
  echo "Running database migrations..."
  npx prisma migrate deploy
fi

exec node dist/index.js
