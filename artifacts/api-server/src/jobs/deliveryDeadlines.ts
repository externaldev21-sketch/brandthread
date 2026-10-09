import { logger } from "../lib/logger";
import { runAutoRefundSweep, runDeadlineWarnings } from "../lib/delivery/autoRefund";
import { pollShippedOrders, syncOrderTracking } from "../lib/delivery/trackingSync";
import { scheduleJob } from "./runner";

const INTERVAL_MS = 10 * 60 * 1000;
let running = false;

/**
 * Every ten minutes: (1) poll carriers for shipped orders, (2) auto-refund
 * whatever passed its deadline undelivered (asking the carrier one last time
 * first), (3) warn sellers at 5 days / 2 days / 12 hours. Every step is
 * idempotent — refund keys are deterministic and warning levels are claimed
 * with a conditional update — so overlapping servers are safe; the flag only
 * avoids piling runs up on one server. The seller payout for delivered
 * orders is released by the money sweep (jobs/moneySweep.ts).
 */
export async function runDeliveryDeadlinesJob(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const polled = await pollShippedOrders({ now });
    const refunds = await runAutoRefundSweep({ now, checkCarrier: (orderId) => syncOrderTracking(orderId) });
    const warned = await runDeadlineWarnings(now);
    if (polled || refunds.refunded || refunds.partial || refunds.failed || warned) {
      logger.info({ job: "deliveryDeadlines", polled, ...refunds, warned }, "Delivery deadlines job made progress");
    }
  } catch (err) {
    logger.error({ err, job: "deliveryDeadlines" }, "Delivery deadlines job failed");
  } finally {
    running = false;
  }
}

export function startDeliveryDeadlinesJob(): void {
  scheduleJob("deliveryDeadlines", () => runDeliveryDeadlinesJob(), { intervalMs: INTERVAL_MS, initialDelayMs: 0 });
}
