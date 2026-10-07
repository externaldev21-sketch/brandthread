import { logger } from "../lib/logger";
import { completeEndedAdCampaigns } from "../lib/ads/adDeliveryService";

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Completes paid ad campaigns whose flight is over (completion_reason
 * 'ended'). Serving already excludes them by ends_at; this keeps the stored
 * status honest for seller lists. Budget exhaustion completes campaigns
 * inline at billing time, so it needs no sweep.
 */
export async function runAdCampaignLifecycle(now = new Date()): Promise<void> {
  try {
    const completed = await completeEndedAdCampaigns(now);
    if (completed > 0) logger.info({ job: "adCampaignLifecycle", completed }, "Ended ad campaigns completed");
  } catch (err) {
    logger.error({ err, job: "adCampaignLifecycle" }, "Ad campaign lifecycle job failed");
  }
}

export function startAdCampaignLifecycleJob(): void {
  void runAdCampaignLifecycle();
  setInterval(() => void runAdCampaignLifecycle(), INTERVAL_MS).unref?.();
  logger.info({ job: "adCampaignLifecycle", intervalMs: INTERVAL_MS }, "Ad campaign lifecycle job scheduled");
}
