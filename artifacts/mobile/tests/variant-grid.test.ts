import { describe, expect, it } from 'vitest';
import { generateVariantCombinations, buildVariantTitle, applyBulkEditToVariants } from '@/lib/productUtils';

describe('generateVariantCombinations (size × color grid builder)', () => {
  it('returns no combinations when there are no options', () => {
    expect(generateVariantCombinations([])).toEqual([]);
  });

  it('returns one combination per value for a single option', () => {
    const combos = generateVariantCombinations([
      { id: 'opt-size', name: 'Size', values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }] },
    ]);
    expect(combos).toHaveLength(2);
    expect(combos.map(c => c.map(v => v.value))).toEqual([['S'], ['M']]);
  });

  it('builds the full cross product for size × color', () => {
    const combos = generateVariantCombinations([
      { id: 'opt-size', name: 'Size', values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }, { id: 'l', value: 'L' }] },
      { id: 'opt-color', name: 'Color', values: [{ id: 'blk', value: 'Black' }, { id: 'wht', value: 'White' }] },
    ]);
    // 3 sizes × 2 colors = 6 variants
    expect(combos).toHaveLength(6);
    const titles = combos.map(c => buildVariantTitle(c.map(v => v.value))).sort();
    expect(titles).toEqual([
      'L / Black', 'L / White',
      'M / Black', 'M / White',
      'S / Black', 'S / White',
    ]);
  });

  it('extends the cross product with a third (custom) option, e.g. Material', () => {
    const combos = generateVariantCombinations([
      { id: 'opt-size', name: 'Size', values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }] },
      { id: 'opt-color', name: 'Color', values: [{ id: 'blk', value: 'Black' }] },
      { id: 'opt-material', name: 'Material', values: [{ id: 'cot', value: 'Cotton' }, { id: 'poly', value: 'Polyester' }] },
    ]);
    // 2 sizes × 1 color × 2 materials = 4 variants
    expect(combos).toHaveLength(4);
    const titles = combos.map(c => buildVariantTitle(c.map(v => v.value))).sort();
    expect(titles).toEqual([
      'M / Black / Cotton', 'M / Black / Polyester',
      'S / Black / Cotton', 'S / Black / Polyester',
    ]);
  });

  it('supports a fully custom option with freeform values (no size/color presets)', () => {
    const combos = generateVariantCombinations([
      { id: 'opt-edition', name: 'Edition', values: [{ id: 'std', value: 'Standard' }, { id: 'ltd', value: 'Limited' }] },
    ]);
    expect(combos.map(c => buildVariantTitle(c.map(v => v.value)))).toEqual(['Standard', 'Limited']);
  });

  it('preserves optionId/valueId pairing needed to reconstruct a variant', () => {
    const combos = generateVariantCombinations([
      { id: 'opt-size', name: 'Size', values: [{ id: 's', value: 'S' }] },
      { id: 'opt-color', name: 'Color', values: [{ id: 'blk', value: 'Black' }] },
    ]);
    expect(combos[0]).toEqual([
      { optionId: 'opt-size', valueId: 's', value: 'S' },
      { optionId: 'opt-color', valueId: 'blk', value: 'Black' },
    ]);
  });
});

describe('applyBulkEditToVariants', () => {
  const variants = [
    { id: 'v1', price: '10.00', qty: '5' },
    { id: 'v2', price: '10.00', qty: '5' },
    { id: 'v3', price: '10.00', qty: '5' },
  ];

  it('only updates variants whose id is in the selection', () => {
    const result = applyBulkEditToVariants(variants, new Set(['v1', 'v3']), { price: '15.00' });
    expect(result.find(v => v.id === 'v1')?.price).toBe('15.00');
    expect(result.find(v => v.id === 'v2')?.price).toBe('10.00');
    expect(result.find(v => v.id === 'v3')?.price).toBe('15.00');
  });

  it('accepts a plain array in place of a Set for the selection', () => {
    const result = applyBulkEditToVariants(variants, ['v2'], { qty: '99' });
    expect(result.find(v => v.id === 'v2')?.qty).toBe('99');
    expect(result.find(v => v.id === 'v1')?.qty).toBe('5');
  });

  it('can set price and stock together in one call', () => {
    const result = applyBulkEditToVariants(variants, new Set(['v1', 'v2', 'v3']), { price: '12.00', qty: '20' });
    expect(result.every(v => v.price === '12.00' && v.qty === '20')).toBe(true);
  });

  it('leaves a field untouched when it is omitted from the edit', () => {
    const result = applyBulkEditToVariants(variants, new Set(['v1']), { qty: '7' });
    expect(result.find(v => v.id === 'v1')).toEqual({ id: 'v1', price: '10.00', qty: '7' });
  });

  it('does not mutate the original array', () => {
    const original = [...variants];
    applyBulkEditToVariants(variants, new Set(['v1']), { price: '999.00' });
    expect(variants).toEqual(original);
  });
});
