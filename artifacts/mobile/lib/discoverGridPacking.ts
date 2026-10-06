/**
 * Pure packing logic for the For You / Fits Explore grid (DiscoverGrid) —
 * extracted from the component so it can be unit-tested without pulling in
 * react-native. See DiscoverGrid.tsx for the rendering side.
 */
import type { DiscoverPost } from '@/lib/discoverFeed';

export type GridRow =
  | { key: string; type: 'normal'; tiles: DiscoverPost[]; cols?: 2 }
  | { key: string; type: 'feature'; big: DiscoverPost; small: DiscoverPost[] }
  | { key: string; type: 'rail'; kind: 'justDropped' | 'highDemand' | 'trendingBrands' | 'shopTheLook' }
  | { key: string; type: 'people' };

export function buildGridRows(
  posts: DiscoverPost[],
  opts: {
    showRails: boolean;
    hasJustDropped: boolean;
    hasHighDemand: boolean;
    hasTrendingBrands?: boolean;
    hasShopTheLook?: boolean;
    hasPeople: boolean;
  },
): GridRow[] {
  const rows: GridRow[] = [];
  let i = 0;
  // Tracks actual TILES emitted so far (not rows processed) — a feature
  // block fires once this crosses the next threshold, self-correcting by 5
  // tiles past wherever it last fired, matching "every ~5th tile a 2x2
  // feature" (Instagram Explore's own packing rate) as closely as a fixed
  // 3-wide row grid can (3 and 5 share no common factor below 15, so an
  // exact "every 5th tile" can't land on a row boundary — this settles
  // into a steady ~2-normal-rows-then-1-feature cadence, a feature roughly
  // every 9 tiles). Counting rows instead of tiles here previously made
  // features fire every ~5 ROWS (~15 tiles) instead — far rarer than
  // intended, and never at all for a For You feed under ~15 posts.
  let tilesEmitted = 0;
  let nextFeatureAt = 5;
  let insertedJustDropped = false;
  let insertedHighDemand = false;
  let insertedTrendingBrands = false;
  let insertedShopTheLook = false;
  let tilesSincePeople = 0;

  while (i < posts.length) {
    if (tilesEmitted >= nextFeatureAt && i + 2 < posts.length) {
      rows.push({ key: `feature-${i}`, type: 'feature', big: posts[i], small: [posts[i + 1], posts[i + 2]] });
      i += 3;
      tilesEmitted += 3;
      tilesSincePeople += 3;
      nextFeatureAt = tilesEmitted + 5;
    } else {
      const chunk = posts.slice(i, i + 3);
      rows.push({ key: `normal-${i}`, type: 'normal', tiles: chunk });
      i += chunk.length;
      tilesEmitted += chunk.length;
      tilesSincePeople += chunk.length;
    }

    if (opts.showRails && !insertedJustDropped && rows.length >= 2 && opts.hasJustDropped) {
      rows.push({ key: 'rail-just-dropped', type: 'rail', kind: 'justDropped' });
      insertedJustDropped = true;
    }
    if (opts.showRails && !insertedHighDemand && insertedJustDropped && rows.length >= 5 && opts.hasHighDemand) {
      rows.push({ key: 'rail-high-demand', type: 'rail', kind: 'highDemand' });
      insertedHighDemand = true;
    }
    if (opts.showRails && !insertedTrendingBrands && insertedHighDemand && rows.length >= 8 && opts.hasTrendingBrands) {
      rows.push({ key: 'rail-trending-brands', type: 'rail', kind: 'trendingBrands' });
      insertedTrendingBrands = true;
    }
    if (opts.showRails && !insertedShopTheLook && insertedTrendingBrands && rows.length >= 11 && opts.hasShopTheLook) {
      rows.push({ key: 'rail-shop-the-look', type: 'rail', kind: 'shopTheLook' });
      insertedShopTheLook = true;
    }
    if (opts.hasPeople && tilesSincePeople >= 20) {
      rows.push({ key: `people-${i}`, type: 'people' });
      tilesSincePeople = 0;
    }
  }
  return balanceTrailingRow(rows);
}

/**
 * The 3-wide grid used to end on a partial row (1 or 2 tiles followed by
 * empty black space — QA-0268/0270). Re-pack only the tail, keeping every
 * post: a trailing pair becomes one 2-column row; a lone trailing tile is
 * merged with the 3 tiles of the grid row before it into two 2-column rows.
 * Rails/people rows in between are left where they are.
 */
export function balanceTrailingRow(rows: GridRow[]): GridRow[] {
  const lastIdx = rows.length - 1;
  const last = rows[lastIdx];
  if (!last || last.type !== 'normal' || last.tiles.length >= 3) return rows;
  if (last.tiles.length === 2) {
    return [...rows.slice(0, lastIdx), { ...last, cols: 2 }];
  }
  // One trailing tile — find the previous grid (normal/feature) row.
  let prevIdx = lastIdx - 1;
  while (prevIdx >= 0 && rows[prevIdx].type !== 'normal' && rows[prevIdx].type !== 'feature') prevIdx--;
  const prev = rows[prevIdx];
  if (!prev || prevIdx !== lastIdx - 1) return rows;
  const prevTiles = prev.type === 'feature' ? [prev.big, ...prev.small] : prev.type === 'normal' ? prev.tiles : [];
  if (prevTiles.length !== 3) return rows;
  const four = [...prevTiles, ...last.tiles];
  return [
    ...rows.slice(0, prevIdx),
    { key: `${prev.key}-a`, type: 'normal', tiles: four.slice(0, 2), cols: 2 },
    { key: `${prev.key}-b`, type: 'normal', tiles: four.slice(2), cols: 2 },
  ];
}
