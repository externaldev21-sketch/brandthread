import { describe, expect, it } from 'vitest';
import { buildServerVariants, sanitizeMoneyInput } from '../productSave';

describe('buildServerVariants — what Save sends to POST /api/products', () => {
  it('sends one default variant with the price and In-stock count when there are no options', () => {
    // The bug: this used to be `variants: []` — no price, no stock, unbuyable.
    expect(buildServerVariants({
      name: 'Ribbed Knit Beanie', options: [], variants: [], priceCents: 3200, stock: 5, lowStockThreshold: 5,
    })).toEqual([{ sku: 'RIBBED-KNIT-BEANIE-DEFAULT', priceCents: 3200, stock: 5, lowStockThreshold: 5 }]);
  });

  it('sends nothing when there is no price to sell at', () => {
    expect(buildServerVariants({ name: 'x', options: [], variants: [], priceCents: 0, stock: 3, lowStockThreshold: 5 })).toEqual([]);
  });

  it('carries each variant\'s size and color from its options, falling back to the base price', () => {
    const options = [
      { id: 'o1', type: 'size', name: 'Size', values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }] },
      { id: 'o2', type: 'color', name: 'Color', values: [{ id: 'blk', value: 'Black' }] },
    ];
    const variants = [
      { id: 'v1', sku: '', inventoryQuantity: 4, optionValues: [{ optionId: 'o1', valueId: 's' }, { optionId: 'o2', valueId: 'blk' }] },
      { id: 'v2', sku: 'TEE-M', priceCents: 4500, inventoryQuantity: 0, optionValues: [{ optionId: 'o1', valueId: 'm' }, { optionId: 'o2', valueId: 'blk' }] },
    ];
    expect(buildServerVariants({ name: 'Tee', options, variants, priceCents: 4000, stock: 0, lowStockThreshold: 3 })).toEqual([
      { size: 'S', color: 'Black', sku: 'TEE-1', priceCents: 4000, stock: 4, lowStockThreshold: 3 },
      { size: 'M', color: 'Black', sku: 'TEE-M', priceCents: 4500, stock: 0, lowStockThreshold: 3 },
    ]);
  });
});

describe('sanitizeMoneyInput (QA-0219)', () => {
  it.each([
    ['ab-12.345', '12.34'],
    ['-5', '5'],
    ['12.3.4', '12.34'],
    ['19,99', '19.99'],
    ['.5', '0.5'],
    ['1e3', '13'],
    ['', ''],
    ['32.00', '32.00'],
  ])('%s → %s', (input, out) => {
    expect(sanitizeMoneyInput(input)).toBe(out);
  });
});
