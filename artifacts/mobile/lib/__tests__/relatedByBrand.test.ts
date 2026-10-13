import { describe, expect, it } from 'vitest';
import { splitRelatedByBrand } from '../relatedByBrand';

describe('splitRelatedByBrand', () => {
  const rows = [
    { id: 'a', ownerId: 'seller_1' },
    { id: 'b', ownerId: 'seller_2' },
    { id: 'c', sellerId: 'seller_1' },
    { id: 'd', ownerId: 'seller_3' },
    { id: 'e', ownerId: 'seller_1' },
  ];

  it('puts the same seller (ownerId or sellerId) in the brand row, keeping order', () => {
    const { brand, others } = splitRelatedByBrand(rows, 'seller_1', 6, 4);
    expect(brand.map((r) => r.id)).toEqual(['a', 'c', 'e']);
    expect(others.map((r) => r.id)).toEqual(['b', 'd']);
  });

  it('applies each row its own limit', () => {
    const { brand, others } = splitRelatedByBrand(rows, 'seller_1', 2, 1);
    expect(brand.map((r) => r.id)).toEqual(['a', 'c']);
    expect(others.map((r) => r.id)).toEqual(['b']);
  });

  it('has no brand row without a seller id', () => {
    const { brand, others } = splitRelatedByBrand(rows, undefined, 6, 10);
    expect(brand).toEqual([]);
    expect(others).toHaveLength(5);
  });
});
