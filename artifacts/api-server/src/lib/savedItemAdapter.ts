/**
 * Shared shape for a saved item enriched with live price/stock badges.
 * Used by the authenticated Saved feed (routes/saved.ts, routes/collections.ts)
 * and the public collection share view (routes/public.ts).
 */
import type { savedItems } from "@workspace/db";
import { fetchProductBadgeInfo, isBackInStockRecent } from "./savedProductBadges";
import { deletedProductIds } from "./productVisibility";

/** Drop saved product rows whose product the seller deleted (target_id has no FK). */
export async function withoutDeletedProducts<T extends { itemType: string; targetId: string }>(rows: T[]): Promise<T[]> {
  const deleted = await deletedProductIds(rows.filter((r) => r.itemType === "product").map((r) => r.targetId));
  return deleted.size === 0 ? rows : rows.filter((r) => !(r.itemType === "product" && deleted.has(r.targetId)));
}

export async function adaptSavedRows(allRows: (typeof savedItems.$inferSelect)[]) {
  const rows = await withoutDeletedProducts(allRows);
  const productIds = rows.filter((r) => r.itemType === "product").map((r) => r.targetId);
  const badgeInfo = await fetchProductBadgeInfo(productIds);

  return rows.map((r) => {
    const badges = badgeInfo.get(r.targetId);
    const currentPriceCents = badges?.priceCents ?? null;
    const priceDropped = !!(
      badges && r.savedPriceCents != null && currentPriceCents != null && currentPriceCents < r.savedPriceCents
    );
    return {
      id:            r.id,
      type:          r.itemType,
      targetId:      r.targetId,
      title:         r.title,
      subtitle:      r.subtitle   ?? undefined,
      accentColor:   r.accentColor ?? undefined,
      collectionId:  r.collectionId ?? undefined,
      savedAt:       r.createdAt?.toISOString() ?? new Date().toISOString(),
      notifyOnPriceDrop: r.notifyOnPriceDrop,
      image:         badges?.image ?? undefined,
      brand:         badges?.brand ?? undefined,
      priceCents:    currentPriceCents ?? undefined,
      oldPriceCents: priceDropped ? r.savedPriceCents ?? undefined : undefined,
      priceDropped,
      inStock:       badges?.inStock,
      lowStock:      badges?.lowStock ?? false,
      soldOut:       badges?.soldOut ?? false,
      backInStock:   badges ? badges.inStock && isBackInStockRecent(r.backInStockAt) : false,
    };
  });
}
