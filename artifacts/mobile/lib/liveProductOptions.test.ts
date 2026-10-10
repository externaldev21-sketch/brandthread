import { describe, expect, it } from 'vitest';
import { toLiveProductOptions } from './liveProductOptions';

const base = { variantCount: 1, maxPriceCents: 2000, moderationLocked: false };

describe('toLiveProductOptions', () => {
  it('keeps active unlocked products with image and price, in-stock first', () => {
    const out = toLiveProductOptions({
      total: 4,
      items: [
        { ...base, id: 'a', name: 'Sold out tee', status: 'active', image: null, minPriceCents: 1500, totalStock: 0 },
        { ...base, id: 'b', name: 'Hoodie', status: 'active', image: 'https://x/h.jpg', minPriceCents: 6000, totalStock: 4 },
        { ...base, id: 'c', name: 'Draft', status: 'draft', image: null, minPriceCents: 100, totalStock: 9 },
        { ...base, id: 'd', name: 'Locked', status: 'active', image: null, minPriceCents: 100, totalStock: 9, moderationLocked: true },
      ],
    });
    expect(out.map((p) => p.id)).toEqual(['b', 'a']);
    expect(out[0]).toEqual({ id: 'b', name: 'Hoodie', imageUrl: 'https://x/h.jpg', priceCents: 6000, totalStock: 4 });
  });

  it('handles empty and missing responses', () => {
    expect(toLiveProductOptions(null)).toEqual([]);
    expect(toLiveProductOptions({ total: 0, items: [] })).toEqual([]);
  });
});
