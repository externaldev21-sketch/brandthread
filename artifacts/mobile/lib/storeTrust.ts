/**
 * Store trust signals shown to buyers (features 64 + 65): "Ships in N days"
 * from the seller's own shipping settings, and the detail ratings buyers give
 * next to their overall stars (shipping speed, item as described).
 */
export type RatingAggregate = { avg: number; count: number };
export type StoreDetailRatings = { shipSpeed: RatingAggregate; accuracy: RatingAggregate };

/** "Ships in 1 day" / "Ships in 3 days"; null when the store hasn't set shipping up. */
export function shipsInLabel(processingDays: number | null | undefined): string | null {
  if (processingDays == null || !Number.isFinite(processingDays) || processingDays < 0) return null;
  if (processingDays === 0) return 'Ships today';
  return `Ships in ${processingDays} ${processingDays === 1 ? 'day' : 'days'}`;
}

/** The two detail rows, in the order the store's Reviews screen lists them. */
export const DETAIL_RATING_ROWS = [
  { key: 'accuracy', label: 'Item as described' },
  { key: 'shipSpeed', label: 'Shipping' },
] as const;

export function hasDetailRatings(details: StoreDetailRatings | null | undefined): boolean {
  return !!details && (details.shipSpeed.count > 0 || details.accuracy.count > 0);
}
