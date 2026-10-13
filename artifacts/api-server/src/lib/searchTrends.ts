/**
 * Pure ranking for the Discover search empty state's "Trending" list
 * (TikTok's "You may like": a numbered list of searches with a Hot/New tag).
 *
 * Input is real search_log counts per normalized query, split into the last
 * 24h and the 48h before that. Nothing is invented: a query needs at least
 * MIN_TREND_SEARCHES real searches to appear, and a tag is only attached when
 * the counts actually show it.
 */

export const TREND_WINDOW_HOURS = 72;
export const TREND_RECENT_HOURS = 24;
export const MIN_TREND_SEARCHES = 2;

export interface QueryCounts {
  /** Normalized query (search_log.normalized). */
  term: string;
  /** Searches in the last 24h. */
  recent: number;
  /** Searches in the 48h before that. */
  prior: number;
}

export type TrendTag = "hot" | "new" | null;

export interface RankedTrend {
  term: string;
  rank: number;
  /** Total searches over the whole 72h window. */
  count: number;
  tag: TrendTag;
}

const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Last-24h searches count double, so a rising query outranks a fading one. */
export function trendScore(c: QueryCounts): number {
  return 2 * n(c.recent) + n(c.prior);
}

/**
 * "new": searched at least 3 times in the last day and never in the two days
 * before. "hot": at least 4 searches in the last day and a daily rate at
 * least double the previous two days' daily average.
 */
export function trendTag(c: QueryCounts): TrendTag {
  const recent = n(c.recent);
  const prior = n(c.prior);
  if (prior === 0 && recent >= 3) return "new";
  if (recent >= 4 && recent >= 2 * (prior / 2)) return "hot";
  return null;
}

/** Junk filter: too short, too long, or no letters/digits at all. */
export function isRankableTerm(term: string): boolean {
  const t = term.trim();
  return t.length >= 2 && t.length <= 60 && /[\p{L}\p{N}]/u.test(t);
}

export function rankSearchTrends(rows: QueryCounts[], limit: number): RankedTrend[] {
  const lim = Math.max(0, Math.floor(limit));
  return rows
    .filter((r) => isRankableTerm(r.term) && n(r.recent) + n(r.prior) >= MIN_TREND_SEARCHES)
    .sort((a, b) => trendScore(b) - trendScore(a) || n(b.recent) - n(a.recent) || a.term.localeCompare(b.term))
    .slice(0, lim)
    .map((r, i) => ({ term: r.term.trim(), rank: i + 1, count: n(r.recent) + n(r.prior), tag: trendTag(r) }));
}
