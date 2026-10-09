import { logger } from "../lib/logger";
import { runAffiliatePayouts } from "../lib/affiliate/payouts";
import { scheduleJob } from "./runner";

const INTERVAL_MS = 15 * 60 * 1000;
let running = false;

/**
 * Every 15 minutes: reverse commissions on refunded orders, promote commissions
 * whose return window has passed, and pay creators (Stripe Connect transfers,
 * only when AFFILIATE_PAYOUTS_ENABLED=true and Stripe is configured). Every
 * step is idempotent, so overlapping servers are safe.
 */
export async function runAffiliatePayoutsJob(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runAffiliatePayouts({ now });
    if (result.paid || result.failed || result.promoted || result.reversed) {
      logger.info({ job: "affiliatePayouts", ...result }, "Affiliate payout run made progress");
    }
  } catch (err) {
    logger.error({ err, job: "affiliatePayouts" }, "Affiliate payout run failed");
  } finally {
    running = false;
  }
}

export function startAffiliatePayoutsJob(): void {
  scheduleJob("affiliatePayouts", () => runAffiliatePayoutsJob(), { intervalMs: INTERVAL_MS });
}
