import { describe, expect, it } from 'vitest';
import { parseSalesFlags, previewSalesFlags, SALES_FLAG_LABEL } from './productSalesFlags';

describe('parseSalesFlags', () => {
  it('keeps only known flags', () => {
    expect(parseSalesFlags({ a: 'best_seller', b: 'slow_mover', c: 'hot', d: null })).toEqual({ a: 'best_seller', b: 'slow_mover' });
  });
  it('ignores non-object responses', () => {
    expect(parseSalesFlags(null)).toEqual({});
    expect(parseSalesFlags(['best_seller'])).toEqual({});
  });
});

describe('previewSalesFlags', () => {
  it('flags the top active seller only, never slow movers', () => {
    const flags = previewSalesFlags([
      { id: 'a', status: 'active', totalSales: 40 },
      { id: 'b', status: 'active', totalSales: 33 },
      { id: 'c', status: 'draft', totalSales: 90 },
      { id: 'd', status: 'active', totalSales: 0 },
    ] as any);
    expect(flags).toEqual({ a: 'best_seller' });
  });
  it('labels in sentence case', () => {
    expect(SALES_FLAG_LABEL).toEqual({ best_seller: 'Best seller', slow_mover: 'Slow mover' });
  });
});
