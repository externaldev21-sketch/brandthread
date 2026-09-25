import "./instrument";
import app from "./app";
import { validateEnv } from "./lib/env";
import { logger } from "./lib/logger";
import { flushMonitoring } from "./lib/monitoring";
import { startAbandonedCartJob } from "./jobs/abandonedCartRecovery";
import { startTrendingJob }       from "./jobs/computeTrending";
import { startSellerRankingJob }  from "./jobs/computeSellerRanking";
import { startTeamInviteReminderJob } from "./jobs/teamInviteReminder";
import { startScheduledDropBroadcastJob } from "./jobs/scheduledDropBroadcasts";
import { startSellerTrialReminderJob } from "./jobs/sellerTrialReminder";
import { startDesignStudioObjectCleanupJob } from "./jobs/designStudioObjectCleanup";
import { startMoneySweepJob } from "./jobs/moneySweep";
import { startStoryCleanupJob } from "./jobs/storyCleanup";
import { startPushReceiptCleanupJob } from "./jobs/pushReceiptCleanup";
import { startNotificationBatchFlushJob } from "./jobs/notificationBatchFlush";
import { ensureWebhookEvents } from "./lib/ensureWebhookEvents";
import { pool } from "@workspace/db";

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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    void flushMonitoring().finally(() => process.exit(1));
    return;
  }

  logger.info({ port }, "Server listening");

  // Ensure Stripe webhook endpoint includes all required event types
  // (especially customer.subscription.* for live seller subscription updates)
  ensureWebhookEvents().catch((err) =>
    logger.error({ err }, "ensureWebhookEvents startup call failed"),
  );

  // Background jobs
  startAbandonedCartJob();
  startTrendingJob();
  startSellerRankingJob();
  startTeamInviteReminderJob();
  startScheduledDropBroadcastJob();
  startSellerTrialReminderJob();
  startDesignStudioObjectCleanupJob();
  startMoneySweepJob();
  startStoryCleanupJob();
  startPushReceiptCleanupJob();
  startNotificationBatchFlushJob();
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

    try {
      await pool.end();
      logger.info("Database pool closed");
    } catch (poolErr) {
      logger.error({ err: poolErr }, "Error while closing database pool");
    }

    clearTimeout(forceExitTimer);
    await flushMonitoring();
    process.exit(closeErr ? 1 : 0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
