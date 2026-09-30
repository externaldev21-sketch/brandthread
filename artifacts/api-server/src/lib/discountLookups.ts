/**
 * DB lookups used by the discount-code rule engine's newer rules (first-order,
 * per-customer limit, collection scope). Kept apart from lib/discounts.ts so the
 * core engine stays small and these can be stubbed in unit tests.
 */
import { and, count, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  db, discountCodeUses, orders, shopifyImportCollections, shopifyImportProductMappings,
} from "@workspace/db";

/** Redemptions of one code by one customer. */
export async function countCustomerUses(discountCodeId: string, customerKey: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(discountCodeUses)
    .where(and(eq(discountCodeUses.discountCodeId, discountCodeId), eq(discountCodeUses.customerKey, customerKey)));
  return Number(row?.n ?? 0);
}

/**
 * "First order" = the customer has no earlier PAID, non-cancelled order with
 * this seller. Guests are keyed "guest:<email>" and matched on guest_email.
 */
export async function hasPriorPaidOrder(sellerId: string, customerKey: string): Promise<boolean> {
  const who = customerKey.startsWith("guest:")
    ? eq(orders.guestEmail, customerKey.slice("guest:".length).toLowerCase())
    : eq(orders.buyerId, customerKey);
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.ownerId, sellerId), who, isNotNull(orders.paidAt), ne(orders.status, "cancelled")))
    .limit(1);
  return !!row;
}

/**
 * Product ids belonging to the seller's collections. The seller-owned
 * collections in the catalogue are the imported ones (shopify_import_collections),
 * whose source product ids map to Brandthread products.
 */
export async function resolveCollectionProductIds(sellerId: string, collectionIds: string[]): Promise<Set<string>> {
  if (collectionIds.length === 0) return new Set();
  const collections = await db
    .select({ sourceUrl: shopifyImportCollections.sourceUrl, sourceProductIds: shopifyImportCollections.sourceProductIds })
    .from(shopifyImportCollections)
    .where(and(eq(shopifyImportCollections.ownerId, sellerId), inArray(shopifyImportCollections.id, collectionIds)));
  const out = new Set<string>();
  for (const c of collections) {
    const sourceIds = (Array.isArray(c.sourceProductIds) ? c.sourceProductIds : []).map(String);
    if (sourceIds.length === 0) continue;
    const mapped = await db
      .select({ productId: shopifyImportProductMappings.productId })
      .from(shopifyImportProductMappings)
      .where(and(
        eq(shopifyImportProductMappings.ownerId, sellerId),
        eq(shopifyImportProductMappings.sourceUrl, c.sourceUrl),
        inArray(shopifyImportProductMappings.sourceProductId, sourceIds),
      ));
    for (const m of mapped) out.add(m.productId);
  }
  return out;
}
