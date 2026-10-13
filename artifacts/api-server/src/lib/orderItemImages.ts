/**
 * Product thumbnails for order line items (item 55: order and notification
 * thumbnails show the real product).
 *
 * `order_items` stores no image, only the purchased variant. Variants carry no
 * images either, so a line's thumbnail is its product's first image, resolved
 * through variant → product in ONE query per call (never per item). A line
 * whose variant or product was deleted, or whose product has no photo, gets
 * `null` and the app keeps showing its icon fallback.
 *
 * Response thumbnails are signed the same way the Activity feed signs
 * notification thumbnails (private `/objects/` paths become a short-lived
 * download URL; public http(s) URLs pass through; anything else is dropped).
 * Notification rows instead store the raw path — the feed signs per read.
 */
import { eq, inArray } from "drizzle-orm";
import { db, orderItems, productVariants, products } from "@workspace/db";
import { productThumbnail } from "./activityEvents";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";
import type { publishNotification } from "../routes/notifications-feed";

type NotificationInput = Parameters<typeof publishNotification>[0];

/** Thumbnails signed per order in list responses (the list UI shows four). */
export const ORDER_LIST_THUMB_LIMIT = 4;
/** Same lifetime the Activity feed gives a signed notification thumbnail. */
const IMAGE_URL_TTL_SEC = 60 * 60;
/** Bounds the `IN (...)` list so a seller with a huge history stays under the bind-parameter limit. */
const ORDER_ID_CHUNK = 1000;
const SIGN_CONCURRENCY = 8;

const objectStorage = new ObjectStorageService();

/** A stored product image reference → a URL the app can load, or null. */
export async function signProductImage(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith("/objects/")) return null;
  try {
    return await objectStorage.getObjectEntityDownloadURL(value, IMAGE_URL_TTL_SEC);
  } catch (err) {
    logger.debug({ err }, "Could not sign order item thumbnail");
    return null;
  }
}

/** Signs each distinct path once. */
async function signImagePaths(paths: Array<string | null>): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter((path): path is string => !!path))];
  const signed = new Map<string, string | null>();
  for (let i = 0; i < unique.length; i += SIGN_CONCURRENCY) {
    const batch = unique.slice(i, i + SIGN_CONCURRENCY);
    const urls = await Promise.all(batch.map((path) => signProductImage(path)));
    batch.forEach((path, index) => signed.set(path, urls[index]));
  }
  return signed;
}

/**
 * Order detail: adds `productId` (same meaning as withItemProductIds) and a
 * signed `imageUrl` to each line, in one variant → product query.
 */
export async function withItemImages<T extends { variantId: string | null }>(
  items: T[],
): Promise<Array<T & { productId: string | null; imageUrl: string | null }>> {
  const variantIds = [...new Set(items.map((item) => item.variantId).filter((id): id is string => !!id))];
  if (variantIds.length === 0) return items.map((item) => ({ ...item, productId: null, imageUrl: null }));
  const rows = await db
    .select({ id: productVariants.id, productId: productVariants.productId, images: products.images })
    .from(productVariants)
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));
  const byVariant = new Map(rows.map((row) => [row.id, { productId: row.productId, image: productThumbnail(row.images) }]));
  const signed = await signImagePaths([...byVariant.values()].map((row) => row.image));
  return items.map((item) => {
    const hit = item.variantId ? byVariant.get(item.variantId) : undefined;
    return {
      ...item,
      productId: hit?.productId ?? null,
      imageUrl: hit?.image ? signed.get(hit.image) ?? null : null,
    };
  });
}

export type OrderListItem = {
  id: string;
  productId: string | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  priceCents: number;
  imageUrl: string | null;
};

export type OrderListThumbs = { items: OrderListItem[]; thumbnailUrl: string | null };

/**
 * Order lists: compact line items per order with signed thumbnails, loaded in
 * one query per 1000 orders. Only the first ORDER_LIST_THUMB_LIMIT lines of
 * an order get an image; `itemLimit` additionally caps how many lines are
 * returned (omit it to return every line, e.g. so a "+N more" count is right).
 * Orders with no lines are absent from the map.
 */
export async function loadOrderListThumbs(
  orderIds: string[],
  opts: { itemLimit?: number } = {},
): Promise<Map<string, OrderListThumbs>> {
  const ids = [...new Set(orderIds)];
  const rows: Array<{
    id: string; orderId: string; productName: string; variantLabel: string | null;
    quantity: number; priceCents: number; productId: string | null; images: unknown;
  }> = [];
  for (let i = 0; i < ids.length; i += ORDER_ID_CHUNK) {
    rows.push(...await db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        quantity: orderItems.quantity,
        priceCents: orderItems.priceCents,
        productId: productVariants.productId,
        images: products.images,
      })
      .from(orderItems)
      .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(orderItems.orderId, ids.slice(i, i + ORDER_ID_CHUNK))));
  }

  const grouped = new Map<string, Array<typeof rows[number] & { image: string | null }>>();
  for (const row of rows) {
    const list = grouped.get(row.orderId) ?? [];
    if (opts.itemLimit !== undefined && list.length >= opts.itemLimit) continue;
    list.push({ ...row, image: list.length < ORDER_LIST_THUMB_LIMIT ? productThumbnail(row.images) : null });
    grouped.set(row.orderId, list);
  }

  const signed = await signImagePaths([...grouped.values()].flat().map((row) => row.image));
  const result = new Map<string, OrderListThumbs>();
  for (const [orderId, list] of grouped) {
    const items = list.map((row) => ({
      id: row.id,
      productId: row.productId ?? null,
      productName: row.productName,
      variantLabel: row.variantLabel,
      quantity: row.quantity,
      priceCents: row.priceCents,
      imageUrl: row.image ? signed.get(row.image) ?? null : null,
    }));
    result.set(orderId, { items, thumbnailUrl: items.find((item) => item.imageUrl)?.imageUrl ?? null });
  }
  return result;
}

/**
 * The raw (unsigned) first product image of an order, for a notification's
 * `targetImageUrl` — the feed signs `/objects/` paths when it is read.
 * Best-effort: any failure returns null so a notification is never lost.
 */
export async function orderThumbnailPath(orderId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ images: products.images })
      .from(orderItems)
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(orderItems.orderId, orderId))
      .limit(ORDER_LIST_THUMB_LIMIT);
    for (const row of rows) {
      const image = productThumbnail(row.images);
      if (image) return image;
    }
    return null;
  } catch (err) {
    logger.debug({ err, orderId }, "Could not load order thumbnail for notification");
    return null;
  }
}

/** A notification payload with the order's product thumbnail filled in (an explicit one wins). */
export async function withOrderImage(orderId: string, input: NotificationInput): Promise<NotificationInput> {
  if (input.targetImageUrl) return input;
  const targetImageUrl = await orderThumbnailPath(orderId);
  return targetImageUrl ? { ...input, targetImageUrl } : input;
}
