/**
 * Regression guard for the owner's live observation on #200: the For You
 * grid never showed the spec'd occasional 2x2 "feature" tile (Instagram
 * Explore's own packing pattern). Root cause: buildGridRows counted ROWS
 * processed, not tiles emitted, so a feature fired every ~5 rows (~15
 * tiles) — far rarer than "every ~5th tile", and never at all for a For
 * You feed under ~15 posts (exactly the size real feeds run at today).
 */
import { describe, expect, it } from 'vitest';
import { buildGridRows } from '@/lib/discoverGridPacking';
import type { DiscoverPost } from '@/lib/discoverFeed';

function post(id: string): DiscoverPost {
  return {
    id,
    authorId: `author-${id}`,
    authorName: `Author ${id}`,
    authorHandle: `@author${id}`,
    authorInitials: 'AU',
    authorColor: '#232323',
    authorAccountType: 'seller',
    media: 'photo',
    likesCount: 0,
    commentsCount: 0,
    createdAt: new Date().toISOString(),
  };
}

const NO_RAILS = { showRails: false, hasJustDropped: false, hasHighDemand: false, hasPeople: false };

describe('DiscoverGrid buildGridRows — 2x2 feature tile cadence', () => {
  it('inserts at least one feature row for a typical ~12-post For You feed (previously none below ~15)', () => {
    const posts = Array.from({ length: 12 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, NO_RAILS);
    expect(rows.some((r) => r.type === 'feature')).toBe(true);
  });

  it('inserts multiple feature rows across a larger 30-post feed, not just one every ~15 tiles', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, NO_RAILS);
    const featureCount = rows.filter((r) => r.type === 'feature').length;
    expect(featureCount).toBeGreaterThanOrEqual(3);
  });

  it('never puts the very first row as a feature (top row is always a normal 3-tile row)', () => {
    const posts = Array.from({ length: 12 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, NO_RAILS);
    expect(rows[0].type).toBe('normal');
  });

  it('every post still appears exactly once across all rows (no drops/dupes from the new packing)', () => {
    const posts = Array.from({ length: 23 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, NO_RAILS);
    const seen: string[] = [];
    for (const row of rows) {
      if (row.type === 'normal') seen.push(...row.tiles.map((p) => p.id));
      if (row.type === 'feature') seen.push(row.big.id, ...row.small.map((p) => p.id));
    }
    expect(seen).toEqual(posts.map((p) => p.id));
  });
});

describe('DiscoverGrid buildGridRows — Trending Brands rail (item 47)', () => {
  it('inserts a trendingBrands rail after the high-demand rail when there is enough content', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, { showRails: true, hasJustDropped: true, hasHighDemand: true, hasTrendingBrands: true, hasPeople: false });
    const kinds = rows.filter((r) => r.type === 'rail').map((r) => r.kind);
    expect(kinds).toEqual(['justDropped', 'highDemand', 'trendingBrands']);
  });

  it('never inserts the rail when there are no trending brands', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, { showRails: true, hasJustDropped: true, hasHighDemand: true, hasTrendingBrands: false, hasPeople: false });
    expect(rows.some((r) => r.type === 'rail' && r.kind === 'trendingBrands')).toBe(false);
  });

  it('never inserts any rail when showRails is false (the Fits filter)', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, { showRails: false, hasJustDropped: true, hasHighDemand: true, hasTrendingBrands: true, hasPeople: false });
    expect(rows.some((r) => r.type === 'rail')).toBe(false);
  });
});

describe('DiscoverGrid buildGridRows — Shop the Look rail (item 48)', () => {
  // shopTheLook chains after trendingBrands (same "each rail requires the
  // previous one" convention justDropped/highDemand/trendingBrands already
  // use), so hasTrendingBrands must also be true for it to ever fire.
  const RAILS_BASE = { showRails: true, hasJustDropped: true, hasHighDemand: true, hasTrendingBrands: true, hasPeople: false };

  it('inserts the shopTheLook rail after trendingBrands once enough rows have accumulated', () => {
    const posts = Array.from({ length: 40 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, { ...RAILS_BASE, hasShopTheLook: true });
    const kinds = rows.filter((r) => r.type === 'rail').map((r) => r.kind);
    expect(kinds).toEqual(['justDropped', 'highDemand', 'trendingBrands', 'shopTheLook']);
  });

  it('never inserts the shopTheLook rail when hasShopTheLook is false', () => {
    const posts = Array.from({ length: 40 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, { ...RAILS_BASE, hasShopTheLook: false });
    expect(rows.some((r) => r.type === 'rail' && r.kind === 'shopTheLook')).toBe(false);
  });

  it('never inserts any rail when showRails is false, even with hasShopTheLook true', () => {
    const posts = Array.from({ length: 40 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, { ...RAILS_BASE, showRails: false, hasShopTheLook: true });
    expect(rows.some((r) => r.type === 'rail')).toBe(false);
  });
});
