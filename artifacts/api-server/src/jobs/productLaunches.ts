import { logger } from "../lib/logger";
import { runProductLaunches } from "../lib/productLaunch";

const INTERVAL_MS = 60 * 1000;

export async function runProductLaunchJob(now = new Date()): Promise<void> {
  try {
    const result = await runProductLaunches(now);
    if (result.launched > 0) {
      logger.info({ job: "productLaunches", ...result }, "Product launches processed");
    }
  } catch (err) {
    logger.error({ err, job: "productLaunches" }, "Product launch job failed");
  }
}

export function startProductLaunchJob(): void {
  void runProductLaunchJob();
  setInterval(() => void runProductLaunchJob(), INTERVAL_MS);
  logger.info({ job: "productLaunches", intervalMs: INTERVAL_MS }, "Product launch job scheduled");
}
