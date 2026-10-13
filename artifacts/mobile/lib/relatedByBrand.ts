/**
 * Splits the related-products shelf into "More from this brand" (the same
 * seller's pieces) and everything else ("You might also like"). Pure, so the
 * buyer product page's grouping is unit-tested.
 *
 * Rows from GET /api/public/products/:id/related carry `ownerId`; the demo /
 * preview catalog rows carry `sellerId` — either identifies the seller.
 */
export interface RelatedLike {
  id: string;
  ownerId?: string | null;
  sellerId?: string | null;
}

export function splitRelatedByBrand<T extends RelatedLike>(
  items: readonly T[],
  sellerId: string | null | undefined,
  brandLimit: number,
  othersLimit: number,
): { brand: T[]; others: T[] } {
  const isBrand = (item: T) => !!sellerId && (item.ownerId ?? item.sellerId) === sellerId;
  return {
    brand: items.filter(isBrand).slice(0, brandLimit),
    others: items.filter((item) => !isBrand(item)).slice(0, othersLimit),
  };
}
