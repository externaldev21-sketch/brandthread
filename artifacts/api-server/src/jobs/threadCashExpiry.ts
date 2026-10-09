import { logger } from "../lib/logger";
import { runThreadCashExpiry } from "../lib/threadCash/expiry";
import { expirePendingThreadCashTransfers } from "../lib/threadCash/wallet";
import { sweepThreadCashSellerTopups } from "../lib/threadCash/checkoutTopup";
import { getThreadCashLiabilityReport } from "../lib/threadCash/liability";
import { stripe } from "../lib/stripe";

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Hourly: appends `expiry` ledger entries for reward Thread Cash past its
 * expiry (90 days by default — lib/threadCash/rewardsConfig.ts; oldest-
 * expiring credit first, see lib/threadCash/lots.ts), warns buyers 7 days
 * ahead, returns unclaimed sends to their senders, retries any seller
 * top-up that failed, and logs the outstanding Thread Cash liability for
 * finance. Each step is idempotent, so overlapping or repeated runs never
 * double-post.
 */
export async function runThreadCashMaintenance(now = new Date()) {
  const expiry = await runThreadCashExpiry(now);
  const sendsReturned = await expirePendingThreadCashTransfers(now);
  const topupsRetried = await sweepThreadCashSellerTopups(stripe, { now });
  if (expiry.expiredCents > 0 || expiry.warned > 0 || sendsReturned > 0 || topupsRetried > 0) {
    logger.info({ job: "threadCashExpiry", ...expiry, sendsReturned, topupsRetried }, "Thread Cash maintenance ran");
  }
  await getThreadCashLiabilityReport(undefined, now)
    .then((liability) => logger.info({ job: "threadCashExpiry", liability }, "Thread Cash outstanding liability"))
    .catch((err) => logger.warn({ err, job: "threadCashExpiry" }, "Thread Cash liability report failed"));
  return { ...expiry, sendsReturned, topupsRetried };
}

export function startThreadCashExpiryJob(): void {
  const run = () => {
    void runThreadCashMaintenance().catch((err) =>
      logger.error({ err, job: "threadCashExpiry" }, "Thread Cash expiry job failed"),
    );
  };
  setTimeout(run, 60_000).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
  logger.info({ job: "threadCashExpiry", intervalMs: INTERVAL_MS }, "Thread Cash expiry job scheduled");
}
