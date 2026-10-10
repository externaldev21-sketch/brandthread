import { describe, expect, it } from 'vitest';
import { primaryOption, sizeCells } from './sizeSheet';

const opt = (id: string, name: string, labels: string[]) => ({ id, name, values: labels.map(l => ({ id: `${id}_${l}`, label: l })) });
const variant = (id: string, size: string, color: string, priceCents: number, stock: number, compareAtPriceCents?: number) => ({
  id, title: `${size} / ${color}`, priceCents, compareAtPriceCents, inventoryQuantity: stock, isAvailable: stock > 0,
  optionValues: [{ optionId: 'size', valueId: `size_${size}` }, { optionId: 'color', valueId: `color_${color}` }],
});

describe('primaryOption', () => {
  it('prefers Size, else the first option', () => {
    expect(primaryOption({ options: [opt('color', 'Color', ['Black']), opt('size', 'Size', ['M'])] })?.id).toBe('size');
    expect(primaryOption({ options: [opt('color', 'Color', ['Black'])] })?.id).toBe('color');
    expect(primaryOption({ options: [] })).toBeNull();
  });
});

describe('sizeCells', () => {
  const size = opt('size', 'Size', ['S', 'M', 'L']);
  const product = {
    variants: [
      variant('v1', 'S', 'Black', 9000, 2),
      variant('v2', 'M', 'Black', 8000, 1, 12000),
      variant('v3', 'M', 'White', 9500, 4),
      variant('v4', 'L', 'Black', 9000, 0),
    ],
  } as any;

  it('shows the lowest in-stock price per size, with the struck price when discounted', () => {
    expect(sizeCells(product, size, {})).toEqual([
      { valueId: 'size_S', label: 'S', priceCents: 9000, compareAtCents: null },
      { valueId: 'size_M', label: 'M', priceCents: 8000, compareAtCents: 12000 },
      { valueId: 'size_L', label: 'L', priceCents: null, compareAtCents: null },
    ]);
  });

  it('respects the other picks (colour)', () => {
    const cells = sizeCells(product, size, { color: 'color_White' });
    expect(cells.map(c => c.priceCents)).toEqual([null, 9500, null]);
  });
});
