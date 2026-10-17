import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from "morgan"
import logger from "./logger.js"
import { EventBus } from './events/eventBus.js';
import { EventLog } from './events/eventLog.js';
import { createRouter } from './api/router.js';
import { createPublicRouter } from './api/publicRouter.js';
import { createOAuthRouter } from './api/oauth.js';
import { createBillingRouter, dodoWebhook } from './api/billingRouter.js';
import { createWalletRouter } from './api/walletRouter.js';
import { attachSession } from './api/auth.js';
import { SessionStore } from './auth/session.js';
import { TaskRegistry } from './store/taskRegistry.js';
import { verifyRedisConnection } from './config/redisHealth.js';
import { createDockerClient, resolveDockerSocket } from './config/docker.js';
import { disconnectPrisma, verifyDatabaseConnection } from './db/prisma.js';
import { startPipelineWorker } from './agent/service.js';
import { Sandbox } from './agent/sandbox.js';
import { startJanitor } from './agent/janitor.js';
import { startCatalogRefresh } from './llm/catalog.js';
import { flushEventsToDb } from './repositories/eventRepository.js';
import { flushLlmCalls } from './repositories/llmCallRepository.js';
import { setPoolAlertNotifier, useRedisForSpend } from './agent/spend.js';
import { createRedisClient } from './config/redis.js';

useRedisForSpend(() => createRedisClient());
// Free-pool spend alerts (70/90/100% of the month, today full) can also go to a Slack or Discord
// incoming webhook the owner configures; they are always logged and shown on the owner's pool page.
if (process.env.POOL_ALERT_WEBHOOK_URL) {
  const url = process.env.POOL_ALERT_WEBHOOK_URL;
  setPoolAlertNotifier(async (a) => {
    const text = `${a.level === 'critical' ? '🔴' : '🟠'} Pullwright: ${a.message}`;
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(10_000) });
  });
}

// WORKER_MODE: "both" (default, single process), "api" (HTTP only), "worker" (sandbox host only).
const MODE = (process.env.WORKER_MODE ?? "both") as "both" | "api" | "worker"

const eventLog = new EventLog();
const eventBus = new EventBus(eventLog);
const taskRegistry = new TaskRegistry();
const worker = MODE === "api" ? null : startPipelineWorker(eventBus, taskRegistry);

const PORT = Number(process.env.PORT ?? 3500);
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: frontendUrl, credentials: true }));
// Webhooks need the raw body for signature checks — register before the JSON parser.
if (MODE !== "worker") app.post("/api/webhooks/dodo", ...dodoWebhook);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(
  morgan(":method :url :status :response-time ms", {
    skip: (req) => req.url?.includes("/stream") ?? false,
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

if (MODE !== "worker") {
  const sessionStore = new SessionStore();
  app.use("/api/public", createPublicRouter(eventLog));
  app.use("/api", attachSession(sessionStore));
  app.use("/api/auth", createOAuthRouter(sessionStore));
  app.use("/api", createBillingRouter());
  app.use("/api", createWalletRouter());
  app.use("/api", createRouter(eventBus, taskRegistry, eventLog));
}

app.get("/", (_req, res) => res.redirect(frontendUrl));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "pullwright", mode: MODE }));
app.get("/health/docker", async (_req, res) => {
  try {
    await createDockerClient().ping()
    res.json({ status: "ok" })
  } catch {
    res.status(503).json({ status: "unavailable" })
  }
});
app.get("/health/db", async (_req, res) => {
  const ok = await verifyDatabaseConnection()
  res.status(ok || !process.env.DATABASE_URL ? 200 : 503).json({ status: ok ? "ok" : process.env.DATABASE_URL ? "unavailable" : "disabled" })
});

void verifyRedisConnection().then((ok) => {
  if (!ok) logger.warn("Starting without a working Redis connection — the task queue will not function")
})
void verifyDatabaseConnection()
if (MODE !== "api") {
  void createDockerClient().ping()
    .then(() => logger.info(`Docker connected (${resolveDockerSocket() ?? "default socket"})`))
    .catch((err) => logger.warn(`Docker not reachable — sandbox tasks will fail until it is: ${err instanceof Error ? err.message : err}`))
  startJanitor()
  startCatalogRefresh() // live per-route model prices for budget reservations
}

const server = app.listen(PORT, () => logger.info(`Pullwright ${MODE} listening on ${PORT}`));

const shutdown = async (signal: string) => {
  logger.info(`${signal} received — shutting down`);
  await worker?.close();
  if (MODE !== "api") await Sandbox.reapAll().catch(() => 0);
  await flushEventsToDb().catch(() => 0); // buffered rows must reach Postgres before exit
  await flushLlmCalls().catch(() => 0);
  await disconnectPrisma();
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (err) => logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack }));
process.on("unhandledRejection", (reason) => logger.error(`Unhandled rejection: ${reason}`));
