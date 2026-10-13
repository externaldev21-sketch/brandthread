/**
 * Pure layout logic for Discover's For You masonry (Pinterest home feed —
 * https://mobbin.com/screens/14800a84-8bc1-476f-960a-b7353780defb): a
 * staggered 2-column grid where every tile keeps its photo's own aspect
 * ratio and each new tile goes into whichever column is currently shorter.
 * No react-native imports, so it is unit-testable (tests/discover-masonry.test.ts).
 */
import type { DiscoverPost } from '@/lib/discoverFeed';
import type { SponsoredFeedItem } from '@/lib/feedAds';
import type { GridRow } from '@/lib/discoverGridPacking';

/** Tallest / widest a tile may get (width:height), so one pin never fills a screen. */
export const MIN_ASPECT = 9 / 16;
export const MAX_ASPECT = 4 / 3;

/** Deterministic fallback ratios (width:height) for posts with no known size. */
const FALLBACK_ASPECTS = [3 / 4, 2 / 3, 4 / 5, 1, 3 / 4, 9 / 16, 4 / 5, 2 / 3];

function clamp(n: number): number {
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, n));
}

/**
 * Parses a width:height ratio from the API — posts store it as text
 * ("9:16", "4:5", "1:1"); a positive number is taken as-is. Returns null
 * for anything unusable.
 */
export function parseAspectRatio(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? w / h : null;
}

function hashOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

/** Text-only tiles (no photo) stay square so they never read as tall empty blocks. */
export const TEXT_TILE_ASPECT = 1;

/** Width:height for a tile — the post's real ratio when known, otherwise a stable varied one. */
export function tileAspectRatio(post: Pick<DiscoverPost, 'id' | 'aspectRatio' | 'imageUri'>): number {
  if (!post.imageUri) return TEXT_TILE_ASPECT;
  const real = typeof post.aspectRatio === 'number' && post.aspectRatio > 0 ? post.aspectRatio : null;
  if (real) return clamp(real);
  return FALLBACK_ASPECTS[hashOf(post.id) % FALLBACK_ASPECTS.length];
}

export interface MasonryColumns<T> {
  left: T[];
  right: T[];
  leftHeight: number;
  rightHeight: number;
}

/**
 * Greedy shortest-column split: each item, in feed order, goes to the
 * column that is currently shorter (ties go left). `heightOf` is the
 * rendered height of one tile, `gap` the vertical space between tiles.
 */
export function splitMasonryColumns<T>(items: T[], heightOf: (item: T) => number, gap = 0): MasonryColumns<T> {
  const out: MasonryColumns<T> = { left: [], right: [], leftHeight: 0, rightHeight: 0 };
  for (const item of items) {
    const h = heightOf(item);
    if (out.leftHeight <= out.rightHeight) {
      out.leftHeight += (out.left.length > 0 ? gap : 0) + h;
      out.left.push(item);
    } else {
      out.rightHeight += (out.right.length > 0 ? gap : 0) + h;
      out.right.push(item);
    }
  }
  return out;
}

type MasonryRow = GridRow | { key: string; type: "sponsored"; item: SponsoredFeedItem };
export type MasonrySection =
  | { key: string; type: 'trendingNow' }
  | { key: string; type: 'masonry'; posts: DiscoverPost[] }
  | Exclude<MasonryRow, { type: 'normal' } | { type: 'feature' }>;

/**
 * Turns the Explore grid's rows (lib/discoverGridPacking.ts — which still
 * decides where rails and the people row land) into masonry sections: every
 * run of consecutive post rows becomes one 2-column block. "Trending now"
 * leads when there is trending data.
 */
export function buildMasonrySections(rows: MasonryRow[], { trendingNow }: { trendingNow: boolean }): MasonrySection[] {
  const sections: MasonrySection[] = trendingNow ? [{ key: 'trending-now', type: 'trendingNow' }] : [];
  let run: DiscoverPost[] = [];
  let runKey = '';
  const flush = () => {
    if (run.length > 0) sections.push({ key: `masonry-${runKey}`, type: 'masonry', posts: run });
    run = [];
  };
  for (const row of rows) {
    if (row.type === 'normal' || row.type === 'feature') {
      if (run.length === 0) runKey = row.key;
      run.push(...(row.type === 'normal' ? row.tiles : [row.big, ...row.small]));
    } else {
      flush();
      sections.push(row);
    }
  }
  flush();
  return sections;
}
