import { logger } from "../lib/logger";
import { stripe } from "../lib/stripe";
import { completeEndedAdCampaigns } from "../lib/ads/adDeliveryService";
import { refundCompletedAdCampaigns } from "../lib/ads/adRefunds";

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Completes paid ad campaigns whose flight is over (completion_reason
 * 'ended'). Serving already excludes them by ends_at; this keeps the stored
 * status honest for seller lists. Budget exhaustion completes campaigns
 * inline at billing time, so it needs no sweep.
 *
 * Then refunds the undelivered remainder of completed Stripe-paid campaigns
 * (a flight that ended under-delivered, or an early-stop refund that failed
 * and needs a retry) — see lib/ads/adRefunds.ts.
 */
export async function runAdCampaignLifecycle(now = new Date()): Promise<void> {
  try {
    const completed = await completeEndedAdCampaigns(now);
    if (completed > 0) logger.info({ job: "adCampaignLifecycle", completed }, "Ended ad campaigns completed");
  } catch (err) {
    logger.error({ err, job: "adCampaignLifecycle" }, "Ad campaign lifecycle job failed");
  }
  if (!stripe) return;
  try {
    const outcomes = await refundCompletedAdCampaigns(stripe, now);
    const refunded = outcomes.filter((o) => o.status === "refunded").length;
    const failed = outcomes.filter((o) => o.status === "failed").length;
    if (refunded > 0 || failed > 0) logger.info({ job: "adCampaignLifecycle", refunded, failed }, "Ad campaign refunds swept");
  } catch (err) {
    logger.error({ err, job: "adCampaignLifecycle" }, "Ad campaign refund sweep failed");
  }
}

export function startAdCampaignLifecycleJob(): void {
  void runAdCampaignLifecycle();
  setInterval(() => void runAdCampaignLifecycle(), INTERVAL_MS).unref?.();
  logger.info({ job: "adCampaignLifecycle", intervalMs: INTERVAL_MS }, "Ad campaign lifecycle job scheduled");
}
