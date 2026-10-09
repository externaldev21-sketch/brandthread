export interface SellerRating {
  avgRating: number;
  totalCount: number;
}

/** "4.8 (23)" — or null when the seller has no reviews yet. */
export function formatSellerRating(rating: SellerRating | null): string | null {
  if (!rating || rating.totalCount <= 0) return null;
  return `${rating.avgRating.toFixed(1)} (${rating.totalCount})`;
}
