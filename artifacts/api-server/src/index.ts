import "./instrument";
import app from "./app";
import { validateEnv } from "./lib/env";
import { logger } from "./lib/logger";
import { flushMonitoring } from "./lib/monitoring";
import { flushAnalytics } from "./lib/analytics";
import { ensureWebhookEvents } from "./lib/ensureWebhookEvents";
import { backgroundJobsEnabled, startPerInstanceJobs, startSingletonJobsWithLeadership } from "./jobs/runner";
import { attachLiveWebSocket } from "./ws/liveHub";
import { attachCommunityWebSocket } from "./ws/communityHub";
import { pool } from "@workspace/db";
import { closeRedis } from "./lib/redis";

validateEnv();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let stopSingletonJobs: () => void = () => {};

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    void flushMonitoring().finally(() => process.exit(1));
    return;
  }

  logger.info({ port }, "Server listening");

  // Live-stream WebSocket — attached to this same HTTP server (upgrade
  // requests to /ws/live), not a second port.
  attachLiveWebSocket(server);
  // Community chat realtime channel (/ws/community), same HTTP server.
  attachCommunityWebSocket(server);

  // Ensure Stripe webhook endpoint includes all required event types
  // (especially customer.subscription.* for live seller subscription updates)
  ensureWebhookEvents().catch((err) =>
    logger.error({ err }, "ensureWebhookEvents startup call failed"),
  );

  // Background jobs. Singleton jobs run in exactly one process (Postgres
  // advisory-lock leader); BACKGROUND_JOBS=off leaves them to the worker
  // (src/worker.ts). See jobs/runner.ts.
  startPerInstanceJobs();
  if (backgroundJobsEnabled()) {
    stopSingletonJobs = startSingletonJobsWithLeadership();
  } else {
    logger.info("BACKGROUND_JOBS=off: singleton jobs are left to the worker process");
  }
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// On deploy, the orchestrator sends SIGTERM and expects the process to stop
// accepting new connections, let in-flight requests finish, then exit — not
// drop live requests. SIGINT covers Ctrl+C during local development.
//
// server.close() stops the server from accepting new connections but waits
// for existing keep-alive sockets/in-flight requests to finish on their own,
// which can hang indefinitely against a slow client — SHUTDOWN_TIMEOUT_MS
// forces the process to exit either way.
const SHUTDOWN_TIMEOUT_MS = Number(process.env["SHUTDOWN_TIMEOUT_MS"]) || 20_000;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSingletonJobs();
  logger.info({ signal }, "Shutdown signal received, draining connections");

  const forceExitTimer = setTimeout(() => {
    logger.error(
      { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
      "Graceful shutdown timed out; forcing exit",
    );
    void flushMonitoring().finally(() => process.exit(1));
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  server.close(async (closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr, signal }, "Error while closing HTTP server");
    } else {
      logger.info({ signal }, "HTTP server closed; no longer accepting connections");
    }

    await closeRedis().catch(() => {});
    try {
      await pool.end();
      logger.info("Database pool closed");
    } catch (poolErr) {
      logger.error({ err: poolErr }, "Error while closing database pool");
    }

    clearTimeout(forceExitTimer);
    await flushAnalytics();
    await flushMonitoring();
    process.exit(closeErr ? 1 : 0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
