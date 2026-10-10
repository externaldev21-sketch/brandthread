/**
 * Shared "is this product still shoppable for this viewer" predicates.
 *
 * Products are soft-deleted (`deleted_at`) so a seller can undo within the
 * recovery window; everything that points at a product by id (post tags,
 * saves, bags, live-stream tag JSON) must therefore filter at read time
 * rather than rely on FK cascades.
 */
import { and, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { db, products } from "@workspace/db";

/**
 * Tagged-product rows a viewer may see: never deleted, and only `active`
 * unless the viewer owns the product (sellers keep seeing their own draft /
 * archived tags so editing a post doesn't silently drop them).
 */
export function taggedProductVisibleTo(viewerId: string | null | undefined): SQL {
  const status = viewerId
    ? or(eq(products.status, "active"), eq(products.ownerId, viewerId))!
    : eq(products.status, "active");
  return and(isNull(products.deletedAt), status)!;
}

/** A product row (from a select) that buyers can still purchase. */
export function isProductAvailable(p: { status: string | null; deletedAt: Date | null } | null | undefined): boolean {
  return !!p && !p.deletedAt && p.status === "active";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from `productIds` that the viewer may still see (see taggedProductVisibleTo). */
export async function visibleProductIds(productIds: string[], viewerId: string | null | undefined): Promise<Set<string>> {
  const ids = [...new Set(productIds.filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: products.id }).from(products)
    .where(and(inArray(products.id, ids), taggedProductVisibleTo(viewerId)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Ids from `productIds` whose product is soft-deleted. Saves (text target
 * ids, no FK) use this to hide removed products while leaving unknown ids
 * (legacy / non-product targets) alone.
 */
export async function deletedProductIds(productIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(productIds.filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: products.id }).from(products)
    .where(and(inArray(products.id, ids), isNotNull(products.deletedAt)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Live streams keep their tagged products as JSON (`product_tags`), so a
 * deleted product would linger there. Drop those tags (and a pin on one)
 * from raw `live_streams` rows on read.
 */
export async function filterLiveStreamProductTags<T extends Record<string, any>>(
  rows: T[],
  viewerId: string | null | undefined,
): Promise<T[]> {
  const tagId = (t: any): string | null => (t && typeof t.productId === "string" ? t.productId : null);
  const ids = rows
    .flatMap((r) => (Array.isArray(r.product_tags) ? r.product_tags.map(tagId) : []))
    .concat(rows.map((r) => r.pinned_product_id))
    .filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return rows;
  const visible = await visibleProductIds(ids, viewerId);
  return rows.map((r) => ({
    ...r,
    ...(Array.isArray(r.product_tags)
      ? { product_tags: r.product_tags.filter((t: any) => { const id = tagId(t); return !id || visible.has(id); }) }
      : {}),
    ...(typeof r.pinned_product_id === "string" && !visible.has(r.pinned_product_id) ? { pinned_product_id: null } : {}),
  }));
}
