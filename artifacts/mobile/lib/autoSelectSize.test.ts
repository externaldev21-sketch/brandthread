import { describe, expect, it } from 'vitest';
import { pickAutoSelectSize, type AutoSizeProduct } from './autoSelectSize';
import { buildSizeBadgeModel } from './sizeBadge';
import type { SizeChartLike } from './sizeRecommendation';

const chart = { columns: ['Chest'], unit: 'cm', rows: [{ size: 'S', values: ['88-94'] }, { size: 'M', values: ['94-100'] }, { size: 'L', values: ['100-108'] }] };

function makeProduct(stock: Record<string, boolean>, over: Partial<AutoSizeProduct> & { sizeChart?: SizeChartLike | null } = {}) {
  const sizes = Object.keys(stock);
  return {
    name: 'Field jacket' as string,
    category: 'Outerwear',
    sizeChart: chart as SizeChartLike | null,
    options: [{ id: 'opt_size', name: 'Size', values: sizes.map(s => ({ id: `size_${s}`, label: s })) }],
    variants: sizes.map(s => ({ isAvailable: stock[s], optionValues: [{ optionId: 'opt_size', valueId: `size_${s}` }] })),
    ...over,
  };
}

const saved = { sizes: { outerwear: 'm' } };

describe('pickAutoSelectSize', () => {
  it('preselects the badge recommendation when it is in stock', () => {
    const product = makeProduct({ S: true, M: true, L: true });
    const badgeModel = buildSizeBadgeModel(product, saved);
    expect(badgeModel).toMatchObject({ kind: 'recommend', size: 'M' });
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel, preferences: saved })).toEqual({ optionId: 'opt_size', valueId: 'size_M' });
  });

  it('never overrides a size that is already set (cart edit or a tap)', () => {
    const product = makeProduct({ S: true, M: true, L: true });
    const badgeModel = buildSizeBadgeModel(product, saved);
    expect(pickAutoSelectSize({ product, selections: { opt_size: 'size_L' }, badgeModel, preferences: saved })).toBeNull();
  });

  it('leaves a sold-out saved size unselected', () => {
    const product = makeProduct({ S: true, M: false, L: true });
    const badgeModel = buildSizeBadgeModel(product, saved);
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel, preferences: saved })).toBeNull();
  });

  it('checks stock against the other current selections', () => {
    const product: AutoSizeProduct = {
      name: 'Tee', category: 'Tops',
      options: [
        { id: 'opt_size', name: 'Size', values: [{ id: 'size_M', label: 'M' }] },
        { id: 'opt_color', name: 'Color', values: [{ id: 'color_Black', label: 'Black' }, { id: 'color_Rust', label: 'Rust' }] },
      ],
      variants: [
        { isAvailable: true, optionValues: [{ optionId: 'opt_size', valueId: 'size_M' }, { optionId: 'opt_color', valueId: 'color_Black' }] },
        { isAvailable: false, optionValues: [{ optionId: 'opt_size', valueId: 'size_M' }, { optionId: 'opt_color', valueId: 'color_Rust' }] },
      ],
    };
    const prefs = { sizes: { tops: 'M' } };
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel: null, preferences: prefs })).toEqual({ optionId: 'opt_size', valueId: 'size_M' });
    expect(pickAutoSelectSize({ product, selections: { opt_color: 'color_Rust' }, badgeModel: null, preferences: prefs })).toBeNull();
  });

  it('falls back to the saved category size when the product has no size chart', () => {
    const product = makeProduct({ S: true, M: true, L: true }, { sizeChart: null });
    expect(buildSizeBadgeModel(product, saved)).toBeNull();
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel: null, preferences: saved })).toEqual({ optionId: 'opt_size', valueId: 'size_M' });
  });

  it('does nothing in the no-chart fallback when the saved size is not a chip or the category is unknown', () => {
    const product = makeProduct({ S: true, L: true }, { sizeChart: null });
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel: null, preferences: saved })).toBeNull();
    const unknown = makeProduct({ M: true }, { sizeChart: null, category: 'Accessories', name: 'Tote' });
    expect(pickAutoSelectSize({ product: unknown, selections: {}, badgeModel: null, preferences: saved })).toBeNull();
  });

  it('does nothing for guests or buyers with no saved sizes', () => {
    const product = makeProduct({ S: true, M: true, L: true });
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel: buildSizeBadgeModel(product, null), preferences: null })).toBeNull();
    const noChart = makeProduct({ M: true }, { sizeChart: null });
    expect(pickAutoSelectSize({ product: noChart, selections: {}, badgeModel: null, preferences: { sizes: {} } })).toBeNull();
  });

  it('does nothing for a product without a Size option', () => {
    const product = { name: 'Mug', category: 'Home', options: [], variants: [{ isAvailable: true, optionValues: [] }] };
    expect(pickAutoSelectSize({ product, selections: {}, badgeModel: null, preferences: saved })).toBeNull();
  });
});
