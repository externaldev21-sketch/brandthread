import { describe, expect, it } from 'vitest';
import { parseRange, recommendSize, sizeCategoryFor, type SizeChartLike } from './sizeRecommendation';

const topsIn: SizeChartLike = {
  unit: 'inches',
  columns: ['Chest', 'Waist', 'Length'],
  rows: [
    { size: 'S', values: ['34-36', '28-30', '27'] },
    { size: 'M', values: ['38-40', '32-34', '28'] },
    { size: 'L', values: ['42-44', '36-38', '29'] },
  ],
};
const bottomsCm: SizeChartLike = {
  unit: 'cm',
  columns: ['Waist', 'Hip'],
  rows: [
    { size: '30', values: ['76', '94'] },
    { size: '32', values: ['81', '99'] },
    { size: '34', values: ['86', '104'] },
  ],
};

describe('parseRange', () => {
  it('parses singles, hyphen/en-dash ranges and decimals', () => {
    expect(parseRange('38')).toEqual([38, 38]);
    expect(parseRange('36-38')).toEqual([36, 38]);
    expect(parseRange('36–38 in')).toEqual([36, 38]);
    expect(parseRange('38.5')).toEqual([38.5, 38.5]);
    expect(parseRange('n/a')).toBeNull();
    expect(parseRange(undefined)).toBeNull();
  });
});

describe('recommendSize', () => {
  it('matches a measurement inside a chart range (inch chart, cm measurement)', () => {
    const r = recommendSize(topsIn, { sizes: { measurements: { chestCm: 99, waistCm: 82 } } }, 'tops');
    expect(r?.size).toBe('M');
    expect(r?.confidence).toBe('high');
  });
  it('is medium confidence with one matching dimension', () => {
    const r = recommendSize(topsIn, { sizes: { measurements: { chestCm: 99 } } }, 'tops');
    expect(r).toMatchObject({ size: 'M', confidence: 'medium' });
  });
  it('recommends the larger size when between two rows, with low confidence', () => {
    // 37 in chest = 94 cm, between S (36) and M (38).
    const r = recommendSize(topsIn, { sizes: { measurements: { chestCm: 94 } } }, 'tops');
    expect(r).toMatchObject({ size: 'M', confidence: 'low' });
    expect(r?.reason).toContain('Between S and M');
  });
  it('handles point values with tolerance on a cm chart', () => {
    expect(recommendSize(bottomsCm, { sizes: { measurements: { waistCm: 81.5, hipsCm: 99 } } }, 'bottoms')?.size).toBe('32');
  });
  it('falls back to the saved size when the chart has it', () => {
    expect(recommendSize(topsIn, { sizes: { tops: 'l' } }, 'tops')).toMatchObject({ size: 'L', confidence: 'medium' });
    expect(recommendSize(bottomsCm, { sizes: { bottoms: '32.0' } }, 'bottoms')?.size).toBe('32');
  });
  it('agreeing saved size and measurements raises confidence to high', () => {
    const r = recommendSize(topsIn, { sizes: { tops: 'M', measurements: { chestCm: 99 } } }, 'tops');
    expect(r).toMatchObject({ size: 'M', confidence: 'high' });
  });
  it('returns null with missing data', () => {
    expect(recommendSize(null, { sizes: { tops: 'M' } }, 'tops')).toBeNull();
    expect(recommendSize({ columns: [], rows: [] }, { sizes: { tops: 'M' } }, 'tops')).toBeNull();
    expect(recommendSize(topsIn, null, 'tops')).toBeNull();
    expect(recommendSize(topsIn, { sizes: {} }, 'tops')).toBeNull();
    expect(recommendSize(topsIn, { sizes: { tops: 'XXL' } }, 'tops')).toBeNull();
    // Height alone never drives a recommendation; shoes need a saved size.
    expect(recommendSize(topsIn, { sizes: { measurements: { heightCm: 180 } } }, 'tops')).toBeNull();
    expect(recommendSize(topsIn, { sizes: { measurements: { chestCm: 99 } } }, 'shoes')).toBeNull();
  });
  it('returns null when measurements are far outside the chart and no saved size', () => {
    expect(recommendSize(topsIn, { sizes: { measurements: { chestCm: 160 } } }, 'tops')).toBeNull();
  });
  it('ignores measurements whose column the chart lacks', () => {
    expect(recommendSize(topsIn, { sizes: { measurements: { hipsCm: 95 } } }, 'bottoms')).toBeNull();
  });
});

describe('sizeCategoryFor', () => {
  it('maps common product text', () => {
    expect(sizeCategoryFor('Leather Ankle Boots')).toBe('shoes');
    expect(sizeCategoryFor('Puffer jacket')).toBe('outerwear');
    expect(sizeCategoryFor('Wide-leg jeans')).toBe('bottoms');
    expect(sizeCategoryFor('Boxy tee')).toBe('tops');
    expect(sizeCategoryFor('Candle')).toBeNull();
  });
});
