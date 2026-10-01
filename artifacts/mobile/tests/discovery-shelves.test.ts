import { describe, expect, it } from 'vitest';
import {
  dayHeading, followersLabel, groupDropsByDay, lowestPriceCents, mapTrendingBrand, toProductTileItem,
} from '../lib/discoveryShelves';
import { buildGridRows } from '../lib/discoverGridPacking';

describe('lowestPriceCents / toProductTileItem', () => {
  it('uses the cheapest priced variant, null when none', () => {
    expect(lowestPriceCents({ variants: [{ priceCents: 9000 }, { priceCents: 7500 }, {}] })).toBe(7500);
    expect(lowestPriceCents({ variants: [] })).toBeNull();
    expect(lowestPriceCents({})).toBeNull();
  });

  it('omits price when unknown and never invents one', () => {
    const tile = toProductTileItem({ id: 'p1', name: 'Heavy Hoodie', images: [], variants: [] }, '#111');
    expect(tile).not.toHaveProperty('priceCents');
    expect(tile.imageUri).toBeNull();
    expect(tile.brand).toBe('Seller');
    expect(tile.initials).toBe('HH');
    expect(toProductTileItem({ id: 'p2', name: 'Tee', images: ['a.jpg'], sellerDisplayName: 'Ember', variants: [{ priceCents: 3000 }] }, '#111'))
      .toMatchObject({ imageUri: 'a.jpg', brand: 'Ember', priceCents: 3000 });
  });
});

describe('groupDropsByDay', () => {
  it('groups by local day, sorted, skipping drops without a valid date', () => {
    const d = (id: string, y: number, m: number, day: number, h: number) => ({ id, releaseAt: new Date(y, m, day, h).toISOString() });
    const out = groupDropsByDay([
      d('c', 2026, 9, 3, 10),
      d('a', 2026, 9, 2, 15),
      d('b', 2026, 9, 2, 9),
      { id: 'none', releaseAt: null },
      { id: 'bad', releaseAt: 'nope' },
    ]);
    expect(out.map((x) => x.key)).toEqual(['2026-10-02', '2026-10-03']);
    expect(out[0].drops.map((x) => x.id)).toEqual(['b', 'a']);
    expect(groupDropsByDay([])).toEqual([]);
  });
});

describe('dayHeading', () => {
  const now = new Date(2026, 9, 2, 12);
  it('labels today, tomorrow, then weekday + date', () => {
    expect(dayHeading(new Date(2026, 9, 2), now)).toBe('Today');
    expect(dayHeading(new Date(2026, 9, 3), now)).toBe('Tomorrow');
    expect(dayHeading(new Date(2026, 9, 9), now)).toBe('Fri, Oct 9');
  });
});

describe('trending brand mapping', () => {
  it('formats followers honestly', () => {
    expect(followersLabel(0)).toBeUndefined();
    expect(followersLabel(1)).toBe('1 follower');
    expect(followersLabel(42)).toBe('42 followers');
    expect(followersLabel(1250)).toBe('1.3K followers');
  });

  it('prefers the cover image over the logo', () => {
    expect(mapTrendingBrand({ id: 's', name: 'N', verified: false, logoUrl: 'l', coverImageUrl: 'c', followerCount: 0 }))
      .toEqual({ id: 's', name: 'N', verified: false, imageUri: 'c', followersLabel: undefined });
  });
});

describe('buildGridRows discovery shelves', () => {
  const posts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}` })) as any[];
  const base = { showRails: true, hasJustDropped: false, hasHighDemand: false, hasPeople: false };

  it('appends the shelves below a short feed, once each', () => {
    const rows = buildGridRows(posts, { ...base, hasTrendingProducts: true, hasShopCategories: true });
    const kinds = rows.filter((r) => r.type === 'rail').map((r: any) => r.kind);
    expect(kinds).toEqual(['trendingProducts', 'shopByCategory']);
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'shopByCategory' });
  });

  it('adds nothing when there is no data or rails are off', () => {
    expect(buildGridRows(posts, base).some((r) => r.type === 'rail')).toBe(false);
    expect(buildGridRows(posts, { ...base, showRails: false, hasTrendingProducts: true, hasShopCategories: true })
      .some((r) => r.type === 'rail')).toBe(false);
  });
});
