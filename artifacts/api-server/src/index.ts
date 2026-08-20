import app from "./app";
import { logger } from "./lib/logger";
import { startAbandonedCartJob } from "./jobs/abandonedCartRecovery";
import { startTrendingJob }       from "./jobs/computeTrending";
import { startTeamInviteReminderJob } from "./jobs/teamInviteReminder";
import { ensureWebhookEvents } from "./lib/ensureWebhookEvents";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
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
  startTeamInviteReminderJob();
});
