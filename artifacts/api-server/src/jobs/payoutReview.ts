import { logger } from "../lib/logger";
import { stepDownExpiredPayoutDelays } from "../lib/admin/payoutControls";

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Hourly: new seller/manufacturer accounts whose NEW_ACCOUNT_REVIEW_DAYS
 * window has ended get their payout delay lowered to Stripe's minimum
 * (lib/admin/payoutControls.ts). Admin holds are never touched here.
 */
export function startPayoutReviewJob(): void {
  const run = () => {
    void stepDownExpiredPayoutDelays()
      .then((n) => { if (n > 0) logger.info({ job: "payoutReview", released: n }, "New-account payout delays lifted"); })
      .catch((err) => logger.error({ err, job: "payoutReview" }, "Payout review job failed"));
  };
  setTimeout(run, 90_000).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
  logger.info({ job: "payoutReview", intervalMs: INTERVAL_MS }, "Payout review job scheduled");
}
