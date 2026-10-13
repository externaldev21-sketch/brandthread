import { describe, expect, it } from 'vitest';
import { pickRememberedSize, rememberSize, type LastSizeMemory } from './lastSize';

const product = {
  category: 'Tops',
  options: [
    { id: 'color', name: 'Color', values: [{ id: 'blk', label: 'Black' }] },
    { id: 'size', name: 'Size', values: [{ id: 's', label: 'S' }, { id: 'm', label: 'M' }, { id: 'l', label: 'L' }] },
  ],
  variants: [
    { id: 'v-s', title: 'S', optionValues: [{ optionId: 'color', valueId: 'blk' }, { optionId: 'size', valueId: 's' }], priceCents: 1, inventoryQuantity: 3, isAvailable: true },
    { id: 'v-m', title: 'M', optionValues: [{ optionId: 'color', valueId: 'blk' }, { optionId: 'size', valueId: 'm' }], priceCents: 1, inventoryQuantity: 0, isAvailable: true },
    { id: 'v-l', title: 'L', optionValues: [{ optionId: 'color', valueId: 'blk' }, { optionId: 'size', valueId: 'l' }], priceCents: 1, inventoryQuantity: 2, isAvailable: true },
  ],
};
const mem = (byCategory: Record<string, string>, last: string | null): LastSizeMemory => ({ byCategory, last });

describe('pickRememberedSize', () => {
  it('prefers the size remembered for this category', () => {
    expect(pickRememberedSize(product, mem({ tops: 'l' }, 'S'))).toEqual({ optionId: 'size', valueId: 'l' });
  });
  it('falls back to the most recent size', () => {
    expect(pickRememberedSize(product, mem({ shoes: '10' }, 's'))).toEqual({ optionId: 'size', valueId: 's' });
  });
  it('never preselects a sold-out size', () => {
    expect(pickRememberedSize(product, mem({ tops: 'M' }, null))).toBeNull();
    expect(pickRememberedSize(product, mem({ tops: 'M' }, 'L'))).toEqual({ optionId: 'size', valueId: 'l' });
  });
  it('does nothing without a size option or a matching label', () => {
    expect(pickRememberedSize({ ...product, options: [product.options[0]] }, mem({}, 'M'))).toBeNull();
    expect(pickRememberedSize(product, mem({}, 'XXL'))).toBeNull();
    expect(pickRememberedSize(product, mem({}, null))).toBeNull();
  });
});

describe('rememberSize', () => {
  it('records the size for the category and as the latest', () => {
    expect(rememberSize(mem({ shoes: '10' }, '10'), 'Tops', 'M')).toEqual(mem({ shoes: '10', tops: 'M' }, 'M'));
  });
});
