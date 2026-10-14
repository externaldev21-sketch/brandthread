import { logger } from "../lib/logger";
import { runProductDraws } from "../lib/productDraws";
import { stripe } from "../lib/stripe";

const INTERVAL_MS = 60 * 1000;

export async function runProductDrawJob(now = new Date()): Promise<void> {
  if (!stripe) return;
  try {
    const result = await runProductDraws(stripe, now);
    if (result.drawn > 0) logger.info({ job: "productDraws", ...result }, "Draws run");
  } catch (err) {
    logger.error({ err, job: "productDraws" }, "Draw job failed");
  }
}

export function startProductDrawJob(): void {
  void runProductDrawJob();
  setInterval(() => void runProductDrawJob(), INTERVAL_MS);
  logger.info({ job: "productDraws", intervalMs: INTERVAL_MS }, "Draw job scheduled");
}
