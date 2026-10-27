import { describe, expect, it } from 'vitest';
import {
  MANUFACTURER_CATEGORIES,
  categorizeManufacturer,
  getManufacturerCategory,
  manufacturerCategoryPattern,
} from './categories';

describe('manufacturer categories', () => {
  it('lists the picker categories in order, with unique keys', () => {
    const keys = MANUFACTURER_CATEGORIES.map((category) => category.key);
    expect(keys.slice(0, 6)).toEqual(['cut-and-sew', 'knitwear', 'denim', 'screen-printing', 'embroidery', 'dye-and-wash']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('maps free-text specialties from existing rows to categories', () => {
    expect(categorizeManufacturer('Hoodies, Heavyweight Tees, Fleece')).toEqual(['cut-and-sew', 'knitwear']);
    expect(categorizeManufacturer('Selvedge Denim, Jeans')).toEqual(['denim']);
    expect(categorizeManufacturer('Screen Printing, Graphic Tees')).toEqual(['cut-and-sew', 'screen-printing']);
    expect(categorizeManufacturer('Embroidery, Patches')).toEqual(['embroidery']);
    expect(categorizeManufacturer('Garment Dye, Enzyme Wash')).toEqual(['dye-and-wash']);
    expect(categorizeManufacturer('Footwear', 'Hand-finished leather goods')).toEqual(['leather-and-footwear']);
  });

  it('matches at word starts only', () => {
    // "vintage" contains "tag", "capsule" contains "caps", "hydyed" contains "dye".
    expect(categorizeManufacturer('Vintage capsule collections, hydyed')).toEqual([]);
    expect(categorizeManufacturer('We embroidered caps')).toEqual(['embroidery']);
  });

  it('accepts arrays and ignores empty fields', () => {
    expect(categorizeManufacturer(['Denim'], null, undefined, '')).toEqual(['denim']);
    expect(categorizeManufacturer()).toEqual([]);
  });

  it('builds the same alternation for JS and Postgres, differing only in the boundary', () => {
    const js = manufacturerCategoryPattern('denim', 'js');
    const pg = manufacturerCategoryPattern('denim', 'postgres');
    expect(js).toBe('\\b(denim|jeans|selvedge|selvage)');
    expect(pg).toBe('\\y(denim|jeans|selvedge|selvage)');
    expect(manufacturerCategoryPattern('nope')).toBeNull();
    expect(getManufacturerCategory('denim')?.label).toBe('Denim');
  });
});
