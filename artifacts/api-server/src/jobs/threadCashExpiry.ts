import { logger } from "../lib/logger";
import { runThreadCashExpiry } from "../lib/threadCash/expiry";
import { expirePendingThreadCashTransfers } from "../lib/threadCash/wallet";

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Hourly: appends `expiry` ledger entries for Thread Cash past
 * `thread_cash_config.expiry_days` (oldest-expiring credit first, see
 * lib/threadCash/lots.ts), warns buyers 7 days ahead, and returns unclaimed
 * sends to their senders. Each step is idempotent, so overlapping or
 * repeated runs never double-post. With expiry_days unset (the default) only
 * the send sweep does anything.
 */
export async function runThreadCashMaintenance(now = new Date()) {
  const expiry = await runThreadCashExpiry(now);
  const sendsReturned = await expirePendingThreadCashTransfers(now);
  if (expiry.expiredCents > 0 || expiry.warned > 0 || sendsReturned > 0) {
    logger.info({ job: "threadCashExpiry", ...expiry, sendsReturned }, "Thread Cash maintenance ran");
  }
  return { ...expiry, sendsReturned };
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
