import { logger } from "../lib/logger";
import { stripe } from "../lib/stripe";
import { runSellerReferrals } from "../lib/sellerReferrals/service";
import { sellerReferralConfig } from "../lib/sellerReferrals/config";

const INTERVAL_MS = 60 * 60 * 1000;
let running = false;

/** Hourly: pick up brand → brand sign-ups and credit both brands after the first paid month (BT-313). */
export async function runSellerReferralsJob(now = new Date()): Promise<void> {
  if (running || !sellerReferralConfig().enabled) return;
  running = true;
  try {
    const result = await runSellerReferrals({ stripe, now });
    if (result.synced || result.rewarded || result.voided) logger.info({ job: "sellerReferrals", ...result }, "Seller referrals run made progress");
  } catch (err) {
    logger.error({ err, job: "sellerReferrals" }, "Seller referrals run failed");
  } finally {
    running = false;
  }
}

export function startSellerReferralsJob(): void {
  setInterval(() => void runSellerReferralsJob(), INTERVAL_MS).unref?.();
  logger.info({ job: "sellerReferrals", intervalMs: INTERVAL_MS, enabled: sellerReferralConfig().enabled }, "Seller referrals job scheduled");
}
