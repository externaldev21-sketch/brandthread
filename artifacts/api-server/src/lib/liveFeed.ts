/**
 * Ordering for GET /api/live/feed — the LIVE pager's list of streams.
 *
 * Followed creators first, then by current viewer count (desc), then the
 * longest-running stream first, then id for a stable order. Pure (no DB
 * import) so it can be unit tested without a database.
 */
export interface LiveFeedRow {
  id: string;
  seller_id: string;
  viewer_count: number | string | null;
  started_at: Date | string | null;
  followed?: boolean | null;
}

function ts(v: Date | string | null): number {
  if (!v) return Number.POSITIVE_INFINITY;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function rankLiveFeed<T extends LiveFeedRow>(rows: readonly T[], limit = 50): T[] {
  return [...rows]
    .sort((a, b) =>
      Number(!!b.followed) - Number(!!a.followed)
      || (Number(b.viewer_count) || 0) - (Number(a.viewer_count) || 0)
      || ts(a.started_at) - ts(b.started_at)
      || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}
