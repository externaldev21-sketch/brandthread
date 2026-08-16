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
 */
import { db, cartItems, notificationsFeed } from "@workspace/db";
import { isNull, lt, sql, eq } from "drizzle-orm";

const WINDOW_HOURS = 24;
const INTERVAL_MS  = 30 * 60 * 1000; // 30 minutes

async function runRecovery(): Promise<void> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  try {
    // Find distinct user IDs with stale, un-notified cart items
    const staleUsers = await db
      .selectDistinct({ userId: cartItems.userId })
      .from(cartItems)
      .where(
        sql`${cartItems.updatedAt} < ${cutoff} AND ${cartItems.notifiedAbandonedAt} IS NULL AND ${cartItems.savedForLater} = false`,
      );

    if (staleUsers.length === 0) return;

    const now = new Date();

    // Insert one notification per user
    await db.insert(notificationsFeed).values(
      staleUsers.map((u) => ({
        userId:   u.userId,
        category: "order",
        type:     "abandoned_cart",
        title:    "Still thinking it over?",
        body:     "You left something in your cart. Tap to finish your order before it sells out.",
      })),
    );

    // Mark records so we don't re-notify
    for (const { userId } of staleUsers) {
      await db
        .update(cartItems)
        .set({ notifiedAbandonedAt: now })
        .where(
          sql`${cartItems.userId} = ${userId} AND ${cartItems.notifiedAbandonedAt} IS NULL`,
        );
    }

    console.log(`[abandonedCartRecovery] Notified ${staleUsers.length} buyer(s) about abandoned carts`);
  } catch (err) {
    console.error("[abandonedCartRecovery] Error:", err);
  }
}

export function startAbandonedCartJob(): void {
  // Run once shortly after startup (in case of server restart)
  setTimeout(runRecovery, 5 * 60 * 1000); // 5 min after startup

  // Then run on the recurring interval
  setInterval(runRecovery, INTERVAL_MS);

  console.log("[abandonedCartRecovery] Job scheduled (runs every 30 min)");
}
