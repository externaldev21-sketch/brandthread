import { describe, expect, it } from 'vitest';
import {
  chartUnitOf, colorImageFor, convertChartValue, detailRows, formatHeight, formatModelLine,
  galleryCountLabel, percentOff, readProductPageDetails, usesImperialHeight,
} from './productPageDetails';

describe('readProductPageDetails', () => {
  it('reads seller-set fields and ignores junk', () => {
    const d = readProductPageDetails({
      modelHeightCm: 185, modelSizeWorn: ' L ', fabric: '100% cotton', care: '', origin: null,
      colorImages: { Ember: 'https://x/e.jpg', Bad: 3, ' ': 'https://x/b.jpg' },
    });
    expect(d).toEqual({
      modelHeightCm: 185, modelSizeWorn: 'L', fabric: '100% cotton', care: null, origin: null,
      colorImages: { Ember: 'https://x/e.jpg' },
    });
  });
  it('is empty for rows from before migration 270', () => {
    expect(readProductPageDetails({ id: 'p' })).toEqual({
      modelHeightCm: null, modelSizeWorn: null, fabric: null, care: null, origin: null, colorImages: {},
    });
    expect(readProductPageDetails(null).colorImages).toEqual({});
  });
});

describe('colorImageFor', () => {
  it('matches colour names case-insensitively', () => {
    expect(colorImageFor({ Ember: 'e' }, 'ember')).toBe('e');
    expect(colorImageFor({ Ember: 'e' }, 'Bone')).toBeUndefined();
  });
});

describe('model line', () => {
  it('uses feet and inches in the US and centimetres elsewhere', () => {
    expect(usesImperialHeight('en-US')).toBe(true);
    expect(usesImperialHeight('de-DE')).toBe(false);
    expect(formatHeight(185, 'en-US')).toBe(`6'1"`);
    expect(formatHeight(178, 'en-US')).toBe(`5'10"`);
    expect(formatHeight(185, 'fr-FR')).toBe('185 cm');
  });
  it("copies lululemon's wording", () => {
    expect(formatModelLine({ modelHeightCm: 185, modelSizeWorn: 'L' }, 'en-US')).toBe(`Model is 6'1" and wears a size L`);
    expect(formatModelLine({ modelHeightCm: null, modelSizeWorn: 'M' }, 'en-US')).toBe('Model wears a size M');
    expect(formatModelLine({ modelHeightCm: 185, modelSizeWorn: null }, 'en-US')).toBeNull();
  });
});

describe('detailRows', () => {
  it('lists only the fields the seller filled, in order', () => {
    const rows = detailRows({ modelHeightCm: null, modelSizeWorn: null, fabric: 'Cotton', care: null, origin: 'Portugal', colorImages: {} });
    expect(rows.map(r => r.title)).toEqual(['Fabric', 'Origin']);
  });
});

describe('percentOff', () => {
  it('rounds to a whole percent', () => {
    expect(percentOff(9800, 12800)).toBe(23);
    expect(percentOff(5000, 10000)).toBe(50);
  });
  it('is null without a real discount', () => {
    expect(percentOff(9800, undefined)).toBeNull();
    expect(percentOff(9800, 9800)).toBeNull();
    expect(percentOff(9800, 9000)).toBeNull();
    expect(percentOff(9990, 10000)).toBeNull();
  });
});

describe('size chart units', () => {
  it('reads unit names', () => {
    expect(chartUnitOf('in')).toBe('in');
    expect(chartUnitOf('Inches')).toBe('in');
    expect(chartUnitOf('cm')).toBe('cm');
    expect(chartUnitOf('kg')).toBeNull();
    expect(chartUnitOf(undefined)).toBeNull();
  });
  it('converts numbers and ranges both ways', () => {
    expect(convertChartValue('22.5', 'in', 'cm')).toBe('57.2');
    expect(convertChartValue('21-22', 'in', 'cm')).toBe('53.3–55.9');
    expect(convertChartValue('100', 'cm', 'in')).toBe('39.4');
    expect(convertChartValue('One size', 'in', 'cm')).toBe('One size');
    expect(convertChartValue('22', 'in', 'in')).toBe('22');
  });
});

describe('galleryCountLabel', () => {
  it('shows position over total', () => {
    expect(galleryCountLabel(2, 8)).toBe('3/8');
    expect(galleryCountLabel(0, 1)).toBeNull();
    expect(galleryCountLabel(9, 8)).toBe('8/8');
  });
});
