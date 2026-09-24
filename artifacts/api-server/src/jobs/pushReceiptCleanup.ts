/**
 * Push token cleanup via Expo push receipts.
 *
 * Sending a push only confirms Expo accepted the message ("ticket"); it does
 * not confirm the device is still reachable. Expo recommends polling
 * /getReceipts a while after sending — a DeviceNotRegistered receipt means
 * the app was uninstalled or the token was revoked, so we deactivate it and
 * stop sending to it.
 */
import { logger } from "../lib/logger";
import { reconcilePushReceipts } from "../lib/push";

const INTERVAL_MS = 30 * 60 * 1000;

export async function runPushReceiptCleanup(): Promise<void> {
  try {
    const { checked, deactivated } = await reconcilePushReceipts();
    if (checked > 0) {
      logger.info({ job: "pushReceiptCleanup", checked, deactivated }, "Push receipt cleanup ran");
    }
  } catch (err) {
    logger.error({ err, job: "pushReceiptCleanup" }, "Push receipt cleanup job failed");
  }
}

export function startPushReceiptCleanupJob(): void {
  setTimeout(() => { void runPushReceiptCleanup(); }, 5 * 60 * 1000);
  setInterval(() => { void runPushReceiptCleanup(); }, INTERVAL_MS);
  logger.info({ job: "pushReceiptCleanup", intervalMs: INTERVAL_MS }, "Push receipt cleanup job scheduled");
}
