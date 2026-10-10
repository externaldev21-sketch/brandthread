/**
 * Pure packing logic for the For You / Fits Explore grid (DiscoverGrid) —
 * extracted from the component so it can be unit-tested without pulling in
 * react-native. See DiscoverGrid.tsx for the rendering side.
 */
import type { DiscoverPost } from '@/lib/discoverFeed';

export type GridRow =
  | { key: string; type: 'normal'; tiles: DiscoverPost[] }
  | { key: string; type: 'feature'; big: DiscoverPost; small: DiscoverPost[] }
  | { key: string; type: 'rail'; kind: 'justDropped' | 'highDemand' | 'trendingBrands' | 'shopTheLook' | 'trendingProducts' | 'shopByCategory' }
  | { key: string; type: 'people' };

export function buildGridRows(
  posts: DiscoverPost[],
  opts: {
    showRails: boolean;
    hasJustDropped: boolean;
    hasHighDemand: boolean;
    hasTrendingBrands?: boolean;
    hasShopTheLook?: boolean;
    hasTrendingProducts?: boolean;
    hasShopCategories?: boolean;
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
  let insertedTrendingProducts = false;
  let insertedShopCategories = false;
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
    if (opts.showRails && !insertedTrendingProducts && rows.length >= 14 && opts.hasTrendingProducts) {
      rows.push({ key: 'rail-trending-products', type: 'rail', kind: 'trendingProducts' });
      insertedTrendingProducts = true;
    }
    if (opts.showRails && !insertedShopCategories && rows.length >= 17 && opts.hasShopCategories) {
      rows.push({ key: 'rail-shop-by-category', type: 'rail', kind: 'shopByCategory' });
      insertedShopCategories = true;
    }
    if (opts.hasPeople && tilesSincePeople >= 20) {
      rows.push({ key: `people-${i}`, type: 'people' });
      tilesSincePeople = 0;
    }
  }
  // Short feeds never reach the row thresholds above; the discovery shelves
  // then close the grid, below all existing content.
  if (opts.showRails && rows.length > 0) {
    if (!insertedTrendingProducts && opts.hasTrendingProducts) {
      rows.push({ key: 'rail-trending-products', type: 'rail', kind: 'trendingProducts' });
    }
    if (!insertedShopCategories && opts.hasShopCategories) {
      rows.push({ key: 'rail-shop-by-category', type: 'rail', kind: 'shopByCategory' });
    }
  }
  return rows;
}
