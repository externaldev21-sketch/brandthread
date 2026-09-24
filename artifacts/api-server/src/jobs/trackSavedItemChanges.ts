/**
 * Saved item price / stock tracking — server-side background job.
 *
 * Runs every 20 minutes. For every saved product, compares its live price and
 * stock against the last-known state and fires a push + in-app notification
 * when a buyer's saved item drops in price or comes back in stock. This is
 * the event source the push/activity surfaces can build richer delivery on
 * top of (see notifySavedItemChange below) — today it writes directly to
 * notifications_feed and Expo push, matching the existing waitlist/drop-alert
 * pattern (see lib/dropBroadcast.ts, routes/waitlist.ts).
 */
import { db, savedItems, notificationsFeed } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendPushToUser, stableNotificationId } from "../lib/push";
import { fetchProductBadgeInfo } from "../lib/savedProductBadges";

const INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

export interface TrackSavedItemChangesResult {
  checked: number;
  priceDrops: number;
  backInStock: number;
}

async function notifySavedItemChange(params: {
  userId: string;
  targetId: string;
  type: "price_drop" | "saved_item_back_in_stock";
  title: string;
  body: string;
}): Promise<void> {
  const { userId, targetId, type, title, body } = params;
  await db.insert(notificationsFeed).values({
    userId,
    category: "order",
    type,
    title,
    body,
    targetId,
    targetType: "product",
  });
  await sendPushToUser(userId, {
    title,
    body,
    data: {
      notificationId: stableNotificationId("saved-item", type, userId, targetId, Date.now().toString()),
      productId: targetId,
      type,
    },
  }, "order");
}

export async function runTrackSavedItemChanges(): Promise<TrackSavedItemChangesResult> {
  const result: TrackSavedItemChangesResult = { checked: 0, priceDrops: 0, backInStock: 0 };

  try {
    const rows = await db.select().from(savedItems).where(eq(savedItems.itemType, "product"));
    result.checked = rows.length;
    if (rows.length === 0) return result;

    const badgeInfo = await fetchProductBadgeInfo(rows.map((r) => r.targetId));

    for (const row of rows) {
      const badges = badgeInfo.get(row.targetId);
      if (!badges) continue; // product deleted / no variants left

      if (row.wasOutOfStock && badges.inStock) {
        await db.update(savedItems)
          .set({ wasOutOfStock: false, backInStockAt: new Date() })
          .where(eq(savedItems.id, row.id));
        result.backInStock++;
        await notifySavedItemChange({
          userId: row.userId,
          targetId: row.targetId,
          type: "saved_item_back_in_stock",
          title: "Back in stock!",
          body: `${row.title} is available again — tap to shop before it sells out.`,
        });
      } else if (!row.wasOutOfStock && badges.soldOut) {
        await db.update(savedItems)
          .set({ wasOutOfStock: true })
          .where(eq(savedItems.id, row.id));
      }

      const notifyFloor = row.lastNotifiedPriceCents ?? row.savedPriceCents;
      if (
        row.notifyOnPriceDrop &&
        badges.priceCents != null &&
        notifyFloor != null &&
        badges.priceCents < notifyFloor
      ) {
        await db.update(savedItems)
          .set({ lastNotifiedPriceCents: badges.priceCents })
          .where(eq(savedItems.id, row.id));
        result.priceDrops++;
        await notifySavedItemChange({
          userId: row.userId,
          targetId: row.targetId,
          type: "price_drop",
          title: "Price drop!",
          body: `${row.title} just dropped to $${(badges.priceCents / 100).toFixed(2)}.`,
        });
      }
    }
  } catch (err) {
    logger.error({ err, job: "trackSavedItemChanges" }, "Saved item tracking job failed");
  }

  return result;
}

export function startTrackSavedItemChangesJob(): void {
  setTimeout(() => void runTrackSavedItemChanges(), 3 * 60 * 1000);
  setInterval(() => void runTrackSavedItemChanges(), INTERVAL_MS);
  logger.info({ job: "trackSavedItemChanges", intervalMs: INTERVAL_MS }, "Saved item tracking job scheduled");
}
