/**
 * Buyer/seller notifications for stock and price changes on a product
 * variant. Both write paths (inventory.ts's quick adjust and products.ts's
 * variant edit) call into these so the notification logic lives in one
 * place.
 */
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, notificationsFeed, productVariants, products, savedItems, waitlistEntries } from "@workspace/db";
import { productThumbnail } from "./activityEvents";
import { notifyRestockAudiences } from "./restockAudiences";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";
import { noteVariantPriceLowered, noteVariantStockRaised, trackStockNotificationWork } from "./savedProductAlerts";
import { formatMoney } from "./money/fees";

async function likersOf(productId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: savedItems.userId })
    .from(savedItems)
    .where(and(eq(savedItems.itemType, "product"), eq(savedItems.targetId, productId)));
  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * True exactly when a stock change should alert the seller. Out-of-stock and
 * low-stock are each alerted once, the first time the level crosses into
 * them — not on every subsequent sale within the same band — but hitting
 * zero always gets its own alert even if a low-stock alert already fired for
 * this decline, since "sold out" is a materially more urgent, separately
 * actionable state than "running low".
 */
export function shouldAlertLowStock(input: {
  previousStock: number;
  newStock: number;
  lowStockThreshold: number;
}): boolean {
  if (input.previousStock === input.newStock) return false;
  const wasOut = input.previousStock === 0;
  const wasLow = input.previousStock > 0 && input.previousStock <= input.lowStockThreshold;
  const isOut = input.newStock === 0;
  const isLow = input.newStock > 0 && input.newStock <= input.lowStockThreshold;
  if (isOut) return !wasOut;
  return isLow && !wasLow;
}

/** True exactly when a stock change is a 0 → positive restock. */
/** Compatibility classifier only; actual delivery uses savedProductAlerts' opt-in and reference-price claims. */
export function priceDropRecipients(
  rows: Array<{ userId: string; priceDropAlert: boolean; lastNotifiedPriceCents: number | null }>,
  newPriceCents: number,
): Array<{ userId: string; push: boolean }> {
  const byUser = new Map<string, { userId: string; push: boolean }>();
  for (const row of rows) {
    if (row.lastNotifiedPriceCents != null && newPriceCents >= row.lastNotifiedPriceCents) continue;
    byUser.set(row.userId, { userId: row.userId, push: (byUser.get(row.userId)?.push ?? false) || row.priceDropAlert });
  }
  return [...byUser.values()];
}

export function isRestock(input: { previousStock: number; newStock: number }): boolean {
  return input.previousStock === 0 && input.newStock > 0;
}

/** Seller-facing low/out-of-stock alert, fired once when the level first crosses the threshold. */
export function notifyStockLevelChanged(input: Parameters<typeof notifyStockLevelChangedWork>[0]): Promise<void> {
  return trackStockNotificationWork(notifyStockLevelChangedWork(input));
}

async function notifyStockLevelChangedWork(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  lowStockThreshold: number;
}): Promise<void> {
  // Stock went back up (restock, cancellation, refund): clear the earlier
  // low/out-of-stock alert for this product so the next decline alerts again.
  // notifications_feed_low_stock_unique allows one such row per product, so
  // without this a product could only ever be alerted on once.
  if (input.newStock > input.previousStock) {
    await rearmLowStockAlert(input.ownerId, input.productId)
      .catch((err) => logger.warn({ err, productId: input.productId }, "Low stock alert re-arm failed"));
    return;
  }
  if (!shouldAlertLowStock(input)) return;
  const isOut = input.newStock === 0;

  await publishNotification({
    userId: input.ownerId,
    category: "stock",
    type: "low_stock",
    title: isOut ? "Sold out" : "Low stock",
    body: isOut
      ? `${input.productName} sold out.`
      : `${input.productName} has ${input.newStock} left.`,
    targetId: input.productId,
    targetType: "product",
    cta: "Manage inventory",
    pushChannelId: "stock",
  }).catch((err) => logger.warn({ err, productId: input.productId }, "Low stock notification failed"));
}

/**
 * Notifies waitlist members for a restocked product, once each. Entries for a
 * specific variant are notified only while that variant has stock; product
 * level entries (no variant) on any restock. The UPDATE ... WHERE notified_at
 * IS NULL RETURNING is the claim, so repeated restocks, overlapping writers
 * and the seller's manual "Notify now" can never send a second notification.
 * Returns the user ids that were notified.
 */
export async function notifyWaitlistRestock(input: {
  productId: string;
  ownerId: string;
  productName: string;
  variantId?: string;
}): Promise<string[]> {
  const inStock = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(eq(productVariants.productId, input.productId), gt(productVariants.stock, 0)));
  const inStockIds = inStock.map((v) => v.id);
  const variantIds = input.variantId ? inStockIds.filter((id) => id === input.variantId) : inStockIds;

  const claimed = await db
    .update(waitlistEntries)
    .set({ notifiedAt: new Date() })
    .where(and(
      eq(waitlistEntries.productId, input.productId),
      isNull(waitlistEntries.notifiedAt),
      variantIds.length > 0
        ? or(isNull(waitlistEntries.variantId), inArray(waitlistEntries.variantId, variantIds))
        : isNull(waitlistEntries.variantId),
    ))
    .returning({ userId: waitlistEntries.userId, variantLabel: waitlistEntries.variantLabel });
  if (claimed.length === 0) return [];

  const [product] = await db.select({ images: products.images }).from(products).where(eq(products.id, input.productId)).limit(1);
  const image = productThumbnail(product?.images);
  await Promise.all(claimed.map((entry) =>
    publishNotification({
      userId: entry.userId,
      category: "order",
      type: "waitlist_restock",
      title: "Restock",
      body: `${input.productName}${entry.variantLabel ? ` (${entry.variantLabel})` : ""} is back.`,
      targetId: input.productId,
      targetType: "product",
      targetImageUrl: image,
      cta: "Shop now",
      analyticsOwnerId: input.ownerId,
      pushChannelId: "stock",
    }).catch((err) => logger.warn({ err, userId: entry.userId, productId: input.productId }, "Waitlist restock notification failed"))
  ));
  return [...new Set(claimed.map((c) => c.userId))];
}

export async function rearmLowStockAlert(ownerId: string, productId: string): Promise<void> {
  await db.delete(notificationsFeed).where(and(
    eq(notificationsFeed.userId, ownerId),
    eq(notificationsFeed.type, "low_stock"),
    eq(notificationsFeed.targetId, productId),
  ));
}

/** Buyer-facing restock alert for savers and waitlist members. */
export function notifyBackInStock(input: Parameters<typeof notifyBackInStockWork>[0]): Promise<void> {
  return trackStockNotificationWork(notifyBackInStockWork(input));
}

async function notifyBackInStockWork(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  variantId?: string;
}): Promise<void> {
  void notifyRestockAudiences(input).catch((err) => logger.warn({ err, productId: input.productId }, "Restock audiences failed"));
  if (!isRestock(input)) return;
  const waitlisted = new Set(await notifyWaitlistRestock({
    productId: input.productId,
    ownerId: input.ownerId,
    productName: input.productName,
    variantId: input.variantId,
  }).catch((err) => {
    logger.warn({ err, productId: input.productId }, "Waitlist restock failed");
    return [] as string[];
  }));
  // Someone on the waitlist already got a restock notification; don't double up.
  const likers = (await likersOf(input.productId)).filter((userId) => !waitlisted.has(userId));
  // Stamp the Saved screen's "Back in stock" badge window for everyone who saved this.
  // ./savedProductAlerts does that, and alerts the opted-in savers among
  // `likers`, only on a product-level restock (0 -> any units) — with blocks,
  // cooldown and a chunked fan-out that runs after the seller's response.
  if (likers.length === 0) return;
  noteVariantStockRaised(input.productId, input.newStock - input.previousStock, likers);
}

/** Buyer-facing price drop alert for everyone who saved/wishlisted the product. */
export async function notifyPriceDrop(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousPriceCents: number;
  newPriceCents: number;
}): Promise<void> {
  if (input.newPriceCents >= input.previousPriceCents) return;
  // Only savers opted in, below their own reference price by the minimum
  // drop, deduped via last_notified_price_cents: ./savedProductAlerts.
  noteVariantPriceLowered(input.productId);
}

/**
 * Units went back on the shelf outside a manual stock edit (an order was
 * cancelled or refunded with restock). Call after the restock commits: savers
 * get "Back in stock" when a product goes 0 → >0, and the seller's earlier
 * low/out-of-stock alert is re-armed — the same effects a manual restock has.
 */
export async function notifyStockRestored(
  lines: Array<{ variantId: string; quantity: number }>,
): Promise<void> {
  const restored = new Map<string, number>();
  for (const line of lines) restored.set(line.variantId, (restored.get(line.variantId) ?? 0) + line.quantity);
  if (restored.size === 0) return;
  const rows = await db
    .select({
      variantId: productVariants.id,
      stock: productVariants.stock,
      lowStockThreshold: productVariants.lowStockThreshold,
      productId: products.id,
      productName: products.name,
      ownerId: products.ownerId,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, [...restored.keys()]));
  for (const row of rows) {
    const previousStock = Math.max(0, row.stock - (restored.get(row.variantId) ?? 0));
    const change = { productId: row.productId, ownerId: row.ownerId, productName: row.productName, previousStock, newStock: row.stock };
    await notifyStockLevelChanged({ ...change, lowStockThreshold: row.lowStockThreshold ?? 0 });
    await notifyBackInStock(change).catch((err) =>
      logger.warn({ err, productId: row.productId }, "Back-in-stock after restock failed"));
  }
}
