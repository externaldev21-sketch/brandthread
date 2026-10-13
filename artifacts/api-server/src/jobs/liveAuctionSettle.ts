/**
 * Settles live auctions whose time is up (lib/liveAuctions.ts), once a second
 * so viewers see "<name> won!" right when the clock hits zero. Reads and bids
 * also settle on the spot, so a slow tick never lets a late bid in.
 */
import { logger } from "../lib/logger";
import { settleDueAuctions } from "../lib/liveAuctions";

const SETTLE_INTERVAL_MS = 1_000;

export function startLiveAuctionSettleJob(): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void settleDueAuctions()
      .catch((err) => logger.error({ err, job: "liveAuctionSettle" }, "Live auction settle failed"))
      .finally(() => { running = false; });
  }, SETTLE_INTERVAL_MS);
  timer.unref();
}
