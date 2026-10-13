/**
 * Product photos for order rows in the Activity feed.
 *
 * Only `order_confirmed` / `new_order_received` store a thumbnail when they
 * are published; shipped, delivered, cancelled and the rest don't. Rather
 * than touch every publisher (and leave older rows bare), the feed fills the
 * gap at read time: an order row with no stored image gets the photo of its
 * order's first item. One query per page.
 */
import { db, orderItems, productVariants, products } from "@workspace/db";
import { asc, inArray, eq } from "drizzle-orm";
import { productThumbnail } from "./activityEvents";

/** Feed `targetType`s that point at an order. */
export const ORDER_TARGET_TYPES: ReadonlySet<string> = new Set(["order", "buyer_order"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FeedRowLike = { targetType?: string | null; targetId?: string | null; targetImageUrl?: string | null };

/** Distinct order ids on a page whose rows have no stored image. */
export function orderIdsMissingImage(rows: readonly FeedRowLike[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.targetImageUrl || !row.targetId || !row.targetType) continue;
    if (!ORDER_TARGET_TYPES.has(row.targetType) || !UUID.test(row.targetId)) continue;
    ids.add(row.targetId);
  }
  return [...ids];
}

/** orderId → first item's first product photo (stored path or URL). */
export async function firstItemImageByOrder(orderIds: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (orderIds.length === 0) return result;
  const rows = await db
    .select({ orderId: orderItems.orderId, images: products.images })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(orderItems.orderId, [...orderIds]))
    .orderBy(asc(orderItems.orderId), asc(orderItems.id));
  for (const row of rows) {
    if (result.has(row.orderId)) continue;
    const image = productThumbnail(row.images);
    if (image) result.set(row.orderId, image);
  }
  return result;
}

/** The image to show for a row: its own, else its order's product photo. */
export function storedOrOrderImage(row: FeedRowLike, byOrder: ReadonlyMap<string, string>): string | null {
  if (row.targetImageUrl) return row.targetImageUrl;
  if (row.targetType && ORDER_TARGET_TYPES.has(row.targetType) && row.targetId) {
    return byOrder.get(row.targetId) ?? null;
  }
  return null;
}
