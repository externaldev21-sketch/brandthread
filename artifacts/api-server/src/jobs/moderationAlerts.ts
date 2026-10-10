import { logger } from "../lib/logger";
import { escalateOverdueReports, flushModeratorAlertDigest } from "../lib/moderation/alerts";
import { liftExpiredSuspensions } from "../lib/moderation/userActions";

const DIGEST_INTERVAL_MS = 60 * 1000;
const HOURLY_MS = 60 * 60 * 1000;

/**
 * Moderator alerts (BT-369):
 *  - every minute: send the collapsed "N new reports" digest once its
 *    throttle window has closed;
 *  - hourly: re-alert once for each report still open after 12 hours, and
 *    lift temporary suspensions that have run out.
 * Every step is idempotent and safe across overlapping instances.
 */
export function startModerationAlertsJob(): void {
  const digest = () => {
    void flushModeratorAlertDigest().catch((err) => logger.error({ err, job: "moderationAlerts" }, "Moderator digest failed"));
  };
  const hourly = () => {
    void escalateOverdueReports()
      .then((n) => { if (n > 0) logger.info({ job: "moderationAlerts", escalated: n }, "Overdue reports escalated"); })
      .catch((err) => logger.error({ err, job: "moderationAlerts" }, "Report escalation failed"));
    void liftExpiredSuspensions()
      .then((n) => { if (n > 0) logger.info({ job: "moderationAlerts", reinstated: n }, "Temporary suspensions lifted"); })
      .catch((err) => logger.error({ err, job: "moderationAlerts" }, "Suspension expiry failed"));
  };
  setInterval(digest, DIGEST_INTERVAL_MS).unref?.();
  setTimeout(hourly, 120_000).unref?.();
  setInterval(hourly, HOURLY_MS).unref?.();
  logger.info({ job: "moderationAlerts" }, "Moderation alerts job scheduled");
}
