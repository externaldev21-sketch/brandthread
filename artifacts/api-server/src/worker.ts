/**
 * Always-on background worker: runs the singleton jobs (jobs/runner.ts)
 * without serving the web API, so auto-refunds, payout release, scheduled
 * posts, drops and live reminders run even when no one is using the app.
 *
 * Deploy as an always-on process (`pnpm --filter @workspace/api-server start:worker`)
 * and set BACKGROUND_JOBS=off on the autoscaled web server. Running more than
 * one worker is safe: they elect one leader through a Postgres advisory lock.
 * If PORT is set, a tiny /healthz endpoint is served for platform probes.
 */
import "./instrument";
import http from "node:http";
import { pool } from "@workspace/db";
import { validateEnv } from "./lib/env";
import { logger } from "./lib/logger";
import { flushMonitoring } from "./lib/monitoring";
import { closeRedis } from "./lib/redis";
import { startSingletonJobsWithLeadership } from "./jobs/runner";

validateEnv();

const stopJobs = startSingletonJobsWithLeadership();
logger.info("Background worker started");

const port = Number(process.env.PORT);
const health = Number.isFinite(port) && port > 0
  ? http.createServer((req, res) => {
      res.writeHead(req.url?.endsWith("/healthz") ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, role: "worker" }));
    }).listen(port)
  : null;

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Background worker shutting down");
  stopJobs();
  health?.close();
  await closeRedis().catch(() => {});
  await pool.end().catch(() => {});
  await flushMonitoring();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
