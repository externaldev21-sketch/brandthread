/**
 * Buyer/seller notifications for stock and price changes on a product
 * variant. Both write paths (inventory.ts's quick adjust and products.ts's
 * variant edit) call into these so the notification logic lives in one
 * place.
 */
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, productVariants, products, savedItems, waitlistEntries } from "@workspace/db";
import { productThumbnail } from "./activityEvents";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";
import { noteVariantPriceLowered, noteVariantStockRaised } from "./savedProductAlerts";

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
export function isRestock(input: { previousStock: number; newStock: number }): boolean {
  return input.previousStock === 0 && input.newStock > 0;
}

/** Seller-facing low/out-of-stock alert, fired once when the level first crosses the threshold. */
export async function notifyStockLevelChanged(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  lowStockThreshold: number;
}): Promise<void> {
  if (!shouldAlertLowStock(input)) return;
  const isOut = input.newStock === 0;

  await publishNotification({
    userId: input.ownerId,
    category: "stock",
    type: "low_stock",
    title: isOut ? "Out of stock" : "Low stock alert",
    body: isOut
      ? `${input.productName} just sold out.`
      : `${input.productName} is running low — ${input.newStock} left.`,
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
      title: "Back in stock!",
      body: `${input.productName}${entry.variantLabel ? ` (${entry.variantLabel})` : ""} is available again. Grab it before it sells out.`,
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

/** Buyer-facing restock alert for everyone who saved/wishlisted the product and everyone on its waitlist. */
export async function notifyBackInStock(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  variantId?: string;
}): Promise<void> {
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
