/**
 * Email campaign queue worker: starts scheduled campaigns when due and drains
 * campaigns that are still sending (e.g. resuming after the daily cap resets).
 * Does nothing when the email provider is not configured.
 */
import { logger } from "../lib/logger";
import { getEmailProvider } from "../lib/emailMarketing/provider";
import { processDueCampaigns } from "../lib/emailMarketing/sender";

const INTERVAL_MS = 60_000;
let running = false;

export async function runEmailCampaignJob(): Promise<void> {
  if (running || !getEmailProvider().isConfigured()) return;
  running = true;
  try {
    await processDueCampaigns();
  } catch (err) {
    logger.error({ err }, "Email campaign job failed");
  } finally {
    running = false;
  }
}

export function startEmailCampaignJob(): void {
  const timer = setInterval(() => { void runEmailCampaignJob(); }, INTERVAL_MS);
  timer.unref?.();
}
