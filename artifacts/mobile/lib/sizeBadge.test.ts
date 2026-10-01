import { describe, expect, it } from 'vitest';
import { buildSizeBadgeModel, matchSizeLabel, productSizeLabels } from './sizeBadge';

const chart = {
  columns: ['Chest'],
  unit: 'cm',
  rows: [
    { size: 'S', values: ['88-94'] },
    { size: 'M', values: ['94-100'] },
    { size: 'L', values: ['100-108'] },
  ],
};
const product = (over: Record<string, unknown> = {}) => ({
  name: 'Wool tee',
  category: 'Tops',
  sizeChart: chart,
  options: [{ name: 'Size', values: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }],
  ...over,
});

describe('buildSizeBadgeModel', () => {
  it('shows "Your size" from a saved size with the category reason', () => {
    const m = buildSizeBadgeModel(product(), { sizes: { tops: 'm' } });
    expect(m).toMatchObject({ kind: 'recommend', size: 'M', title: 'Your size: M', reason: 'Based on your saved tops size' });
  });
  it('shows "Recommended" from measurements', () => {
    const m = buildSizeBadgeModel(product(), { sizes: { measurements: { chestCm: 97 } } });
    expect(m).toMatchObject({ kind: 'recommend', size: 'M', title: 'Recommended: M' });
  });
  it('offers Find my size when a chart exists but nothing is saved', () => {
    expect(buildSizeBadgeModel(product(), { sizes: {} })).toEqual({ kind: 'find' });
    expect(buildSizeBadgeModel(product(), null)).toEqual({ kind: 'find' });
  });
  it('shows nothing without a size chart', () => {
    expect(buildSizeBadgeModel(product({ sizeChart: null }), { sizes: { tops: 'M' } })).toBeNull();
    expect(buildSizeBadgeModel(product({ sizeChart: { rows: [] } }), null)).toBeNull();
  });
  it('shows nothing when the category is unknown', () => {
    expect(buildSizeBadgeModel(product({ category: 'Home', name: 'Candle' }), null)).toBeNull();
  });
  it('falls back to Find my size when the recommended size is not sold', () => {
    const p = product({ options: [{ name: 'Size', values: [{ label: 'S' }] }] });
    expect(buildSizeBadgeModel(p, { sizes: { tops: 'M' } })).toEqual({ kind: 'find' });
  });
});

describe('helpers', () => {
  it('matches chip labels case-insensitively', () => {
    expect(matchSizeLabel('m', ['S', 'M'])).toBe('M');
    expect(matchSizeLabel('xl', ['S'])).toBeNull();
    expect(matchSizeLabel('M', null)).toBeNull();
  });
  it('reads size labels from the Size option', () => {
    expect(productSizeLabels(product())).toEqual(['S', 'M', 'L']);
    expect(productSizeLabels({ options: [{ name: 'Color', values: [{ label: 'Red' }] }] })).toBeNull();
  });
});
