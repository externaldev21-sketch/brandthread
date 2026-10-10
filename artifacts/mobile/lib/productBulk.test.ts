import { describe, expect, it } from 'vitest';
import { buildPriceChange, buildStockChange, bulkErrorMessage, priceRangeLabel } from './productBulk';

describe('buildPriceChange', () => {
  it('converts percent to basis points', () => {
    expect(buildPriceChange('percent_down', '10')).toEqual({ mode: 'percent', direction: 'decrease', value: 1000 });
    expect(buildPriceChange('percent_up', '12.5')).toEqual({ mode: 'percent', direction: 'increase', value: 1250 });
  });
  it('converts dollars to cents', () => {
    expect(buildPriceChange('set', '39.99')).toEqual({ mode: 'set', value: 3999 });
    expect(buildPriceChange('amount_down', '5')).toEqual({ mode: 'amount', direction: 'decrease', value: 500 });
  });
  it('rejects empty, zero, malformed and over-100% discounts', () => {
    for (const [mode, input] of [
      ['set', ''], ['set', '0'], ['set', 'abc'], ['percent_down', '0'], ['percent_down', '101'], ['percent_up', '1.234'],
    ] as const) expect(buildPriceChange(mode, input)).toBeNull();
  });
});

describe('bulkErrorMessage', () => {
  it('maps known server codes to friendly text', () => {
    const err = (body: object) => ({ body: JSON.stringify(body) });
    expect(bulkErrorMessage(err({ code: 'PRODUCT_MODERATION_LOCKED' }), 'x')).toMatch(/moderation/);
    expect(bulkErrorMessage(err({ code: 'PLAN_LIMIT_REACHED', message: 'Upgrade to add more.' }), 'x')).toBe('Upgrade to add more.');
    expect(bulkErrorMessage(err({ error: 'Nope' }), 'x')).toBe('Nope');
    expect(bulkErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('priceRangeLabel', () => {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  it('collapses equal bounds', () => {
    expect(priceRangeLabel(1000, 1000, fmt)).toBe('$10.00');
    expect(priceRangeLabel(1000, 2000, fmt)).toBe('$10.00 – $20.00');
    expect(priceRangeLabel(null, null, fmt)).toBe('No price');
  });
});

describe('buildStockChange', () => {
  it('builds set / add / remove from whole numbers', () => {
    expect(buildStockChange('set', '0')).toEqual({ mode: 'set', value: 0 });
    expect(buildStockChange('add', ' 12 ')).toEqual({ mode: 'add', value: 12 });
    expect(buildStockChange('remove', '3')).toEqual({ mode: 'remove', value: 3 });
  });

  it('refuses empty, fractional, negative, no-op and huge quantities', () => {
    expect(buildStockChange('set', '')).toBeNull();
    expect(buildStockChange('set', '1.5')).toBeNull();
    expect(buildStockChange('set', '-2')).toBeNull();
    expect(buildStockChange('add', '0')).toBeNull();
    expect(buildStockChange('set', '1000001')).toBeNull();
  });
});

import {
  applyLocalPrice, applyLocalStock, bulkCatalogFromProducts, computeNewPrice, computeNewStock, filterLocalCatalog,
  planLocalPrice, planLocalStock, stockLevel, stockPreviewFlags, stockStatusLabel, type LocalSourceProduct,
} from './productBulk';

const source = (over: Partial<LocalSourceProduct> & { id: string }): LocalSourceProduct => ({
  name: over.id, status: 'active', media: [{ uri: `img-${over.id}`, isCover: true }],
  pricing: { priceCents: 5000 }, variants: [], inventory: { totalStock: 0, lowStockThreshold: 5 }, ...over,
});

const catalog = () => bulkCatalogFromProducts([
  source({
    id: 'tee', name: 'Classic Tee',
    variants: [{ id: 'tee-s', sku: 'TEE-S', inventoryQuantity: 10 }, { id: 'tee-m', sku: 'TEE-M', inventoryQuantity: 3, priceCents: 5500 }],
    inventory: { totalStock: 13, lowStockThreshold: 5 },
  }),
  source({ id: 'pants', name: 'Sweatpants', status: 'draft', inventory: { totalStock: 47, lowStockThreshold: 8 } }),
]);

describe('local stock rules (mirror api-server bulkStock.ts)', () => {
  it('sets, adds and removes without going below zero or above the cap', () => {
    expect(computeNewStock(4, { mode: 'set', value: 9 })).toBe(9);
    expect(computeNewStock(4, { mode: 'add', value: 3 })).toBe(7);
    expect(computeNewStock(4, { mode: 'remove', value: 10 })).toBe(0);
    expect(computeNewStock(999_999, { mode: 'add', value: 5 })).toBe(1_000_000);
  });
  it('classifies stock against the threshold', () => {
    expect(stockLevel(0, 5)).toBe('out_of_stock');
    expect(stockLevel(5, 5)).toBe('low_stock');
    expect(stockLevel(6, 5)).toBe('in_stock');
  });
  it('labels list rows', () => {
    expect(stockStatusLabel(0, 5).label).toBe('Out of stock');
    expect(stockStatusLabel(3, 5)).toEqual({ level: 'low_stock', label: 'Low stock, 3 left' });
    expect(stockStatusLabel(12, 5).label).toBe('12 in stock');
    expect(stockStatusLabel(2, null).label).toBe('2 in stock');
  });
});

describe('local catalog', () => {
  it('maps products and gives an option-less product one default variant', () => {
    const [tee, pants] = catalog();
    expect(tee.product).toMatchObject({ totalStock: 13, minPriceCents: 5000, maxPriceCents: 5500, variantCount: 2, image: 'img-tee' });
    expect(pants.variants).toHaveLength(1);
    expect(pants.product.totalStock).toBe(47);
  });
  it('filters by name and status like the server listing', () => {
    expect(filterLocalCatalog(catalog(), 'tee', 'all').map(p => p.id)).toEqual(['tee']);
    expect(filterLocalCatalog(catalog(), '', 'draft').map(p => p.id)).toEqual(['pants']);
  });
  it('previews a stock change with before/after totals and low/out flags', () => {
    const res = planLocalStock(catalog(), ['tee', 'pants'], { mode: 'remove', value: 5 });
    const tee = res.items.find(i => i.productId === 'tee')!;
    expect(tee).toMatchObject({ beforeTotal: 13, afterTotal: 5, lowAfter: 1, outAfter: 1, changed: true });
    expect(res.summary).toMatchObject({ products: 2, changedProducts: 2, variants: 3, lowAfter: 1, outAfter: 1 });
    expect(res.preview).toBe(true);
  });
  it('applies a stock change and recomputes totals', () => {
    const cat = catalog();
    const next = applyLocalStock(cat, planLocalStock(cat, ['tee'], { mode: 'set', value: 2 }));
    expect(next[0].product.totalStock).toBe(4);
    expect(next[1].product.totalStock).toBe(47);
  });
  it('previews and applies a price change with compare-at', () => {
    const cat = catalog();
    const res = planLocalPrice(cat, ['tee'], { mode: 'percent', direction: 'decrease', value: 1000 }, 'end_99', 'previous');
    expect(res.items[0]).toMatchObject({ beforeMin: 5000, beforeMax: 5500, afterMin: 4499, afterMax: 4999 });
    const next = applyLocalPrice(cat, res);
    expect(next[0].variants.map(v => [v.priceCents, v.compareAtCents])).toEqual([[4499, 5000], [4999, 5500]]);
    expect(computeNewPrice(1000, { mode: 'amount', direction: 'increase', value: 50 }, 'end_00')).toBe(1100);
  });
});

describe('stockPreviewFlags', () => {
  const v = (n: number) => Array.from({ length: n }, (_, i) => ({ variantId: `v${i}`, sku: '', before: 0, after: 0, lowStockThreshold: 5 }));
  it('labels single-variant and whole-product outcomes plainly', () => {
    expect(stockPreviewFlags({ lowAfter: 1, outAfter: 0, variants: v(1) })).toEqual([{ level: 'low_stock', label: 'Low stock' }]);
    expect(stockPreviewFlags({ lowAfter: 0, outAfter: 3, variants: v(3) })).toEqual([{ level: 'out_of_stock', label: 'Out of stock' }]);
  });
  it('counts variants when only some end low or out', () => {
    expect(stockPreviewFlags({ lowAfter: 2, outAfter: 1, variants: v(3) }).map(f => f.label)).toEqual(['1 out of stock', '2 low stock']);
    expect(stockPreviewFlags({ lowAfter: 0, outAfter: 0, variants: v(3) })).toEqual([]);
  });
});
