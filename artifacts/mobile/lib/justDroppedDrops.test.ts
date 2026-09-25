import { describe, expect, it } from 'vitest';
import { computeJustDroppedDrops } from './justDroppedDrops';

describe('computeJustDroppedDrops', () => {
  const following = [{ userId: 'seller-a' }, { userId: 'seller-b' }];

  it('keeps only drops from sellers the buyer follows', () => {
    const drops = [
      { id: '1', name: 'Drop A', ownerId: 'seller-a', seller: { brandName: 'A Brand' } },
      { id: '2', name: 'Drop C', ownerId: 'seller-c', seller: { brandName: 'C Brand' } },
    ];
    const result = computeJustDroppedDrops(following, drops);
    expect(result.map((d) => d.id)).toEqual(['1']);
    expect(result[0].sellerName).toBe('A Brand');
  });

  it('returns nothing when the buyer follows no sellers with a live drop', () => {
    const drops = [{ id: '1', name: 'Drop C', ownerId: 'seller-c' }];
    expect(computeJustDroppedDrops(following, drops)).toEqual([]);
  });

  it('sorts most-recently-released first', () => {
    const drops = [
      { id: 'old', name: 'Old', ownerId: 'seller-a', releaseAt: '2024-01-01T00:00:00Z' },
      { id: 'new', name: 'New', ownerId: 'seller-b', releaseAt: '2024-06-01T00:00:00Z' },
    ];
    const result = computeJustDroppedDrops(following, drops);
    expect(result.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('falls back to displayName then "Seller" when no brand name is set', () => {
    const drops = [
      { id: '1', name: 'A', ownerId: 'seller-a', seller: { displayName: 'Jamie' } },
      { id: '2', name: 'B', ownerId: 'seller-b', seller: null },
    ];
    const result = computeJustDroppedDrops(following, drops);
    expect(result.find((d) => d.id === '1')?.sellerName).toBe('Jamie');
    expect(result.find((d) => d.id === '2')?.sellerName).toBe('Seller');
  });

  it('caps the result at the given limit', () => {
    const drops = Array.from({ length: 15 }, (_, i) => ({ id: `${i}`, name: `Drop ${i}`, ownerId: 'seller-a' }));
    expect(computeJustDroppedDrops(following, drops, 5)).toHaveLength(5);
  });
});
