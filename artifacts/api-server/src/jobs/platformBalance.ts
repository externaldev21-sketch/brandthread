import { logger } from "../lib/logger";
import { stripe } from "../lib/stripe";
import { checkPlatformBalance } from "../lib/money/platformBalance";

const INTERVAL_MS = 60 * 60 * 1000;
let running = false;

/**
 * At boot and hourly: confirm the platform Stripe account is on manual
 * payouts (PAYOUT_MODE=hold) and that its balance still covers seller_held.
 * Read-only; problems are logged at error level (Sentry) — see
 * lib/money/platformBalance.ts.
 */
export async function runPlatformBalanceJob(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await checkPlatformBalance({ stripe });
  } catch (err) {
    logger.error({ err, job: "platformBalance" }, "Platform balance check failed");
  } finally {
    running = false;
  }
}

export function startPlatformBalanceJob(): void {
  void runPlatformBalanceJob();
  setInterval(() => void runPlatformBalanceJob(), INTERVAL_MS).unref?.();
  logger.info({ job: "platformBalance", intervalMs: INTERVAL_MS }, "Platform balance check scheduled");
}
