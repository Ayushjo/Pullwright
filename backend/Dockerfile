# Pullwright backend image. The same image runs as:
#   WORKER_MODE=api     → HTTP API only (Railway)
#   WORKER_MODE=worker  → task worker next to a Docker daemon (EC2)
#   WORKER_MODE=both    → single process (local dev)
FROM node:22-bookworm-slim

RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

COPY scripts/railway-start.sh /railway-start.sh
RUN chmod +x /railway-start.sh

ENV NODE_ENV=production WORKER_MODE=api
EXPOSE 3500
CMD ["/railway-start.sh"]
