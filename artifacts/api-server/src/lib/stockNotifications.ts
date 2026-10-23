/**
 * Buyer/seller notifications for stock and price changes on a product
 * variant. Both write paths (inventory.ts's quick adjust and products.ts's
 * variant edit) call into these so the notification logic lives in one
 * place.
 *
 * Saved items alerts (buyers who saved a product): "Back in stock" when the
 * product's total stock goes from 0 to positive, "Price drop" when its lowest
 * price falls. At most one of each per buyer per product per 48 hours. Both
 * respect the "Saved items alerts" preference (push category "saved").
 */
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, productVariants, products, savedItems, waitlistEntries } from "@workspace/db";
import { productThumbnail } from "./activityEvents";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";

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

/** Minimum gap between two saved items alerts of the same kind, per buyer per product. */
export const SAVED_ALERT_DEDUPE_HOURS = 48;
const SAVED_ALERT_DEDUPE_MS = SAVED_ALERT_DEDUPE_HOURS * 60 * 60 * 1000;

/** True when the product's price fell (both values in cents). */
export function isPriceDrop(input: { previousPriceCents: number; newPriceCents: number }): boolean {
  return Number.isFinite(input.previousPriceCents)
    && Number.isFinite(input.newPriceCents)
    && input.newPriceCents > 0
    && input.newPriceCents < input.previousPriceCents;
}

/** True when a buyer may receive another alert of a kind last sent at `lastAlertedAt`. */
export function isOutsideSavedAlertWindow(lastAlertedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastAlertedAt) return true;
  return now.getTime() - lastAlertedAt.getTime() >= SAVED_ALERT_DEDUPE_MS;
}

export function formatAlertPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`;
}

/** Notification copy for saved items alerts. */
export function savedAlertCopy(
  input: { kind: "restock"; productName: string } | { kind: "price_drop"; productName: string; priceCents: number },
): { title: string; body: string } {
  if (input.kind === "restock") {
    return {
      title: `Back in stock: ${input.productName}`,
      body: "An item you saved is available again.",
    };
  }
  return {
    title: `Price drop: ${input.productName} now ${formatAlertPrice(input.priceCents)}`,
    body: "An item you saved is now available at a lower price.",
  };
}

/** SQL guard: no alert of this kind went to the row's buyer in the last 48 hours. */
function outsideWindow(column: typeof savedItems.restockAlertedAt | typeof savedItems.priceDropAlertedAt) {
  return or(isNull(column), lt(column, sql`now() - make_interval(hours => ${SAVED_ALERT_DEDUPE_HOURS})`));
}

function savedProductRows(productId: string) {
  return and(eq(savedItems.itemType, "product"), eq(savedItems.targetId, productId));
}

/** Live product row and its variant totals, or null when it is gone or archived. */
async function liveProductState(productId: string): Promise<{ images: unknown; totalStock: number; minPriceCents: number | null } | null> {
  const [product] = await db
    .select({ images: products.images, status: products.status, deletedAt: products.deletedAt })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product || product.deletedAt || product.status === "archived") return null;
  const [totals] = await db
    .select({
      totalStock: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`,
      minPriceCents: sql<number | null>`min(${productVariants.priceCents})::int`,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
  return { images: product.images, totalStock: totals?.totalStock ?? 0, minPriceCents: totals?.minPriceCents ?? null };
}

/**
 * Buyer-facing restock alert for everyone who saved the product, plus the
 * waitlist. Called on every stock write; the saved alert follows the
 * product's total stock, not one variant's:
 *  - total reaches 0  -> saved rows are marked sold out;
 *  - a variant restocks -> rows marked sold out are claimed (UPDATE ...
 *    RETURNING, so concurrent writers never double-send), then only buyers
 *    with no restock alert for this product in the last 48 hours are alerted.
 */
export async function notifyBackInStock(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  variantId?: string;
}): Promise<void> {
  if (input.newStock === 0 && input.previousStock > 0) {
    const state = await liveProductState(input.productId);
    if (state && state.totalStock === 0) {
      await db.update(savedItems)
        .set({ wasOutOfStock: true })
        .where(and(savedProductRows(input.productId), eq(savedItems.wasOutOfStock, false)));
    }
    return;
  }
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

  const state = await liveProductState(input.productId);
  if (!state || state.totalStock === 0) return;
  // The sold-out -> in-stock transition, claimed once. Also stamps the Saved
  // screen's "Back in stock" badge window.
  const restocked = await db.update(savedItems)
    .set({ wasOutOfStock: false, backInStockAt: new Date() })
    .where(and(savedProductRows(input.productId), eq(savedItems.wasOutOfStock, true)))
    .returning({ id: savedItems.id, userId: savedItems.userId });
  // Someone on the waitlist already got a restock notification; don't double up.
  const candidates = restocked.filter((row) => !waitlisted.has(row.userId)).map((row) => row.id);
  if (candidates.length === 0) return;
  const claimed = await db.update(savedItems)
    .set({ restockAlertedAt: new Date() })
    .where(and(inArray(savedItems.id, candidates), outsideWindow(savedItems.restockAlertedAt)))
    .returning({ userId: savedItems.userId });

  const copy = savedAlertCopy({ kind: "restock", productName: input.productName });
  const image = productThumbnail(state.images);
  await Promise.all(claimed.map(({ userId }) =>
    publishNotification({
      userId,
      category: "stock",
      type: "back_in_stock",
      ...copy,
      targetId: input.productId,
      targetType: "product",
      targetImageUrl: image,
      cta: "View item",
      analyticsOwnerId: input.ownerId,
      pushCategory: "saved",
      pushChannelId: "stock",
    }).catch((err) => logger.warn({ err, userId, productId: input.productId }, "Back-in-stock notification failed"))
  ));
}

/**
 * Buyer-facing price drop alert for everyone who saved the product. The
 * alert quotes the product's lowest variant price after the write, and goes
 * only to buyers who kept price alerts on for the item, for whom that price
 * is below the last price they were alerted at (or saved at), and who had no
 * price-drop alert for this product in the last 48 hours. The claim is one
 * UPDATE ... RETURNING, so overlapping writers never double-send.
 */
export async function notifyPriceDrop(input: {
  productId: string;
  ownerId: string;
  productName: string;
  previousPriceCents: number;
  newPriceCents: number;
}): Promise<void> {
  if (!isPriceDrop(input)) return;
  const state = await liveProductState(input.productId);
  const current = state?.minPriceCents;
  if (!state || current == null || current <= 0) return;
  // Rows saved without a price compare against this write's own drop, but
  // only when that drop set the product's lowest price.
  const fallbackBaseline = current === input.newPriceCents ? input.previousPriceCents : null;
  const claimed = await db.update(savedItems)
    .set({ lastNotifiedPriceCents: current, priceDropAlertedAt: new Date() })
    .where(and(
      savedProductRows(input.productId),
      eq(savedItems.notifyOnPriceDrop, true),
      sql`coalesce(${savedItems.lastNotifiedPriceCents}, ${savedItems.savedPriceCents}, ${fallbackBaseline}::int) > ${current}`,
      outsideWindow(savedItems.priceDropAlertedAt),
    ))
    .returning({ userId: savedItems.userId });

  const copy = savedAlertCopy({ kind: "price_drop", productName: input.productName, priceCents: current });
  const image = productThumbnail(state.images);
  await Promise.all(claimed.map(({ userId }) =>
    publishNotification({
      userId,
      category: "stock",
      type: "price_drop",
      ...copy,
      targetId: input.productId,
      targetType: "product",
      targetImageUrl: image,
      cta: "View item",
      analyticsOwnerId: input.ownerId,
      pushCategory: "saved",
      pushChannelId: "stock",
    }).catch((err) => logger.warn({ err, userId, productId: input.productId }, "Price drop notification failed"))
  ));
}
