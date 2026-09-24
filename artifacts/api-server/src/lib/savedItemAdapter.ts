/**
 * Shared shape for a saved item enriched with live price/stock badges.
 * Used by the authenticated Saved feed (routes/saved.ts, routes/collections.ts)
 * and the public collection share view (routes/public.ts).
 */
import type { savedItems } from "@workspace/db";
import { fetchProductBadgeInfo, isBackInStockRecent } from "./savedProductBadges";

export async function adaptSavedRows(rows: (typeof savedItems.$inferSelect)[]) {
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
