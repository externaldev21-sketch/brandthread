/**
 * Abandoned Cart Recovery — server-side background job.
 *
 * Runs every 30 minutes. Finds buyers who have cart items that haven't been
 * updated in ≥ 24 hours and haven't already received an abandonment
 * notification. Sends a push notification and marks the record so they don't
 * get spammed.
 *
 * The window resets whenever the buyer syncs their cart (every app session),
 * so this only fires when someone genuinely hasn't opened the app in 24 hours.
 *
 * Claim-before-notify: the eligible cart items are claimed with a single
 * conditional UPDATE ... RETURNING before any notification is sent. Postgres
 * serializes concurrent UPDATEs against the same rows, so if this job
 * overlaps itself (a slow run still in flight when the next interval fires)
 * or runs on more than one server instance, only the run that actually wins
 * the row lock sees a given cart item in its RETURNING set — the other run's
 * identical UPDATE matches zero of those rows because notifiedAbandonedAt is
 * no longer NULL. That makes a given user's notification generated at most
 * once per abandonment window, even under concurrent execution.
 */
import { db, cartItems, notificationsFeed } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const WINDOW_HOURS = 24;
const INTERVAL_MS  = 30 * 60 * 1000; // 30 minutes

async function runRecovery(): Promise<void> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  const now = new Date();

  try {
    // Atomically claim every stale, un-notified cart item in one statement.
    // A row can only be claimed once: the WHERE clause requires
    // notifiedAbandonedAt IS NULL, so a second, overlapping run's identical
    // UPDATE will affect none of the rows this run already claimed.
    const claimed = await db
      .update(cartItems)
      .set({ notifiedAbandonedAt: now })
      .where(
        sql`${cartItems.updatedAt} < ${cutoff} AND ${cartItems.notifiedAbandonedAt} IS NULL AND ${cartItems.savedForLater} = false`,
      )
      .returning({ userId: cartItems.userId });

    if (claimed.length === 0) return;

    const notifiedUserIds = [...new Set(claimed.map((c: { userId: string }) => c.userId))];

    // One notification per user for the cart items this run claimed. If this
    // insert fails after the claim above committed, those users simply miss
    // this window's reminder (they'll be eligible again only if their cart
    // updates and goes stale again) rather than risk a duplicate — the claim
    // step is what prevents double-notifying, so it must run first.
    await db.insert(notificationsFeed).values(
      notifiedUserIds.map((userId) => ({
        userId,
        category: "order",
        type:     "abandoned_cart",
        title:    "Still thinking it over?",
        body:     "You left something in your cart. Tap to finish your order before it sells out.",
      })),
    );

    logger.info({ job: "abandonedCartRecovery", notifiedUsers: notifiedUserIds.length }, "Abandoned cart notifications sent");
  } catch (err) {
    logger.error({ err, job: "abandonedCartRecovery" }, "Abandoned cart recovery job failed");
  }
}

export function startAbandonedCartJob(): void {
  // Run once shortly after startup (in case of server restart)
  setTimeout(runRecovery, 5 * 60 * 1000); // 5 min after startup

  // Then run on the recurring interval
  setInterval(runRecovery, INTERVAL_MS);

  logger.info({ job: "abandonedCartRecovery", intervalMs: INTERVAL_MS }, "Abandoned cart recovery job scheduled");
}
