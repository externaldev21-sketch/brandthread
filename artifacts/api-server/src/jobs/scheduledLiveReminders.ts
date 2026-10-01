import { logger } from "../lib/logger";
import { sendDueReminders } from "../lib/scheduledLives";

const INTERVAL_MS = 60 * 1000;

/** Sends the "starting soon" reminder for scheduled lives. Claim-by-timestamp makes overlapping runs safe. */
export async function runScheduledLiveReminders(now = new Date()): Promise<void> {
  try {
    const notified = await sendDueReminders(now);
    if (notified > 0) {
      logger.info({ job: "scheduledLiveReminders", notified }, "Scheduled live reminders delivered");
    }
  } catch (err) {
    logger.error({ err, job: "scheduledLiveReminders" }, "Scheduled live reminder job failed");
  }
}

export function startScheduledLiveReminderJob(): void {
  void runScheduledLiveReminders();
  setInterval(() => void runScheduledLiveReminders(), INTERVAL_MS);
  logger.info({ job: "scheduledLiveReminders", intervalMs: INTERVAL_MS }, "Scheduled live reminder job scheduled");
}
