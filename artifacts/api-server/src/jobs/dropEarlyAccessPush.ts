import { logger } from "../lib/logger";
import { deliverDueEarlyAccessPushes } from "../lib/dropEarlyAccessPush";

const INTERVAL_MS = 60 * 1000;

export async function runDropEarlyAccessPush(now = new Date()): Promise<void> {
  try {
    for (const result of await deliverDueEarlyAccessPushes(now)) {
      logger.info({ job: "dropEarlyAccessPush", ...result }, "Drop early-access push delivered");
    }
  } catch (err) {
    logger.error({ err, job: "dropEarlyAccessPush" }, "Drop early-access push job failed");
  }
}

export function startDropEarlyAccessPushJob(): void {
  void runDropEarlyAccessPush();
  setInterval(() => void runDropEarlyAccessPush(), INTERVAL_MS);
  logger.info({ job: "dropEarlyAccessPush", intervalMs: INTERVAL_MS }, "Drop early-access push job scheduled");
}
