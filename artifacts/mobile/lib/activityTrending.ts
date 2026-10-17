/**
 * Activity's inline "Trending brands" section — the pure rules, kept out of
 * the screen so they can be tested directly.
 *
 * Dev's ask: instead of a "Find people to follow" link to a separate page,
 * Activity shows the trending brands themselves, BELOW the activity. New
 * activity goes above it and pushes it down; it is never pinned. With no
 * activity it sits near the top under a quiet "No activity yet" line.
 *
 * Data is the same source as the Trending brands screen
 * (api.publicDiscovery.trendingBrands + mapTrendingBrand), asked with
 * `exclude=following` so brands the viewer already follows, and their own
 * store, never come back.
 */
import type { ActivityChip } from '@/lib/activity';
import type { TrendingBrandRow } from '@/lib/discoveryShelves';

/** Rows shown inline. Dev: "about 5-8". */
export const ACTIVITY_TRENDING_MAX = 8;
/** Asked for a little over the max, so filtering the viewer out still fills the list. */
export const ACTIVITY_TRENDING_FETCH = 12;

/**
 * Which rows to show: the viewer's own store and duplicates dropped (the
 * server already does this with exclude=following; this is a backstop for
 * a stale response), capped at `max`. Empty means the section is hidden.
 */
export function inlineTrendingBrands(
  rows: readonly TrendingBrandRow[],
  selfId: string | null | undefined,
  max: number = ACTIVITY_TRENDING_MAX,
): TrendingBrandRow[] {
  const seen = new Set<string>();
  const out: TrendingBrandRow[] = [];
  for (const row of rows) {
    if (!row.id || row.id === selfId || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The filters that show the section: "All", and "Follows" — the two places
 * the old "Find people to follow" link used to appear. Likes, Comments,
 * Orders and Thread Cash stay about their own rows.
 */
export function showsInlineTrending(chip: ActivityChip): boolean {
  return chip === 'all' || chip === 'follows';
}

export type ActivityFooterPart = 'loadingMore' | 'trending' | 'suggested';

/**
 * What sits under the activity rows, top to bottom. Trending only renders
 * once the LAST page is in (`!hasMore`), so it is never shown mid-list and
 * then shoved down by the next page — and it is one footer node, so it can
 * never appear twice.
 */
export function activityFooterParts({
  loadingMore, hasMore, trendingCount, suggestedCount, chip,
}: {
  loadingMore: boolean;
  hasMore: boolean;
  trendingCount: number;
  suggestedCount: number;
  chip: ActivityChip;
}): ActivityFooterPart[] {
  const parts: ActivityFooterPart[] = [];
  if (loadingMore) parts.push('loadingMore');
  if (!hasMore && trendingCount > 0 && showsInlineTrending(chip)) parts.push('trending');
  if (suggestedCount > 0) parts.push('suggested');
  return parts;
}
