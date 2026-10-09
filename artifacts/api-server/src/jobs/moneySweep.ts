import { logger } from "../lib/logger";
import { runMoneySweep } from "../lib/money/dropLifecycle";
import { scheduleJob } from "./runner";

const INTERVAL_MS = 5 * 60 * 1000;
let running = false;

/**
 * Every five minutes: auto-refund failed preorder drops, finish releases a
 * crash or Stripe outage left behind, and retry label-cost recovery. Every
 * step is idempotent, so overlapping servers are safe; the in-process flag
 * only avoids piling up runs on one server.
 */
export async function runMoneySweepJob(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runMoneySweep(now);
    if (result.failedDrops.length || result.completedDrops || result.releasesSettled) {
      logger.info({ job: "moneySweep", ...result }, "Money sweep made progress");
    }
  } catch (err) {
    logger.error({ err, job: "moneySweep" }, "Money sweep failed");
  } finally {
    running = false;
  }
}

export function startMoneySweepJob(): void {
  scheduleJob("moneySweep", () => runMoneySweepJob(), { intervalMs: INTERVAL_MS, initialDelayMs: 0 });
}
