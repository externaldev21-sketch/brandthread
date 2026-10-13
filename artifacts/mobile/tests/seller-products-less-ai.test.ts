import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) },
}));

import { deriveProductListStatus, productListStatusLabel, totalStockAcrossVariants } from '@/lib/productListStatus';
import {
  DEFAULT_PRODUCTS_VIEW_MODE, PRODUCTS_VIEW_MODE_KEY, loadProductsViewMode, parseProductsViewMode, saveProductsViewMode,
} from '@/lib/productsViewMode';
import { parsePriceCents, parseStock, sanitizePriceInput, sanitizeStockInput } from '@/lib/variantTableInput';

type P = Parameters<typeof deriveProductListStatus>[0];
const product = (over: Partial<P> = {}): P => ({
  status: 'active',
  variants: [],
  inventory: { totalStock: 10, trackQuantity: true, allowOverselling: false, policy: 'deny' },
  salesModel: 'pre-made',
  ...over,
});

describe('product list status (Live / Draft / Sold out)', () => {
  it('published with stock is Live', () => {
    expect(deriveProductListStatus(product())).toBe('live');
    expect(productListStatusLabel(product())).toBe('Live');
  });

  it('draft stays Draft even with 0 stock', () => {
    expect(deriveProductListStatus(product({ status: 'draft', inventory: { totalStock: 0 } }))).toBe('draft');
  });

  it('published with 0 stock across every variant is Sold out', () => {
    const p = product({ variants: [{ inventoryQuantity: 0 }, { inventoryQuantity: 0 }], inventory: { totalStock: 0, trackQuantity: true, policy: 'deny' } });
    expect(deriveProductListStatus(p)).toBe('sold-out');
    expect(productListStatusLabel(p)).toBe('Sold out');
  });

  it('one variant with stock keeps it Live, and variant counts win over a stale total', () => {
    expect(deriveProductListStatus(product({ variants: [{ inventoryQuantity: 0 }, { inventoryQuantity: 2 }], inventory: { totalStock: 0 } }))).toBe('live');
    expect(deriveProductListStatus(product({ variants: [{ inventoryQuantity: 0 }], inventory: { totalStock: 7 } }))).toBe('sold-out');
  });

  it('falls back to the product total when variants have no count', () => {
    expect(totalStockAcrossVariants(product({ variants: [{ inventoryQuantity: undefined }], inventory: { totalStock: 4 } }))).toBe(4);
    expect(totalStockAcrossVariants(product({ variants: [{ inventoryQuantity: -3 }, { inventoryQuantity: 5 }] }))).toBe(5);
  });

  it('is not Sold out when the product can still be bought at 0', () => {
    const zero = { totalStock: 0 };
    expect(deriveProductListStatus(product({ inventory: { ...zero, trackQuantity: false } }))).toBe('live');
    expect(deriveProductListStatus(product({ inventory: { ...zero, allowOverselling: true } }))).toBe('live');
    expect(deriveProductListStatus(product({ inventory: { ...zero, policy: 'continue' } }))).toBe('live');
    expect(deriveProductListStatus(product({ inventory: zero, salesModel: 'pre-order' }))).toBe('live');
  });

  it('passes scheduled / archived / hidden through unchanged', () => {
    expect(deriveProductListStatus(product({ status: 'scheduled' }))).toBe('scheduled');
    expect(deriveProductListStatus(product({ status: 'archived', inventory: { totalStock: 0 } }))).toBe('archived');
    expect(deriveProductListStatus(product({ status: 'hidden' }))).toBe('hidden');
  });
});

describe('products view mode persistence', () => {
  it('parses only known values and defaults to the list', () => {
    expect(DEFAULT_PRODUCTS_VIEW_MODE).toBe('list');
    expect(parseProductsViewMode('grid')).toBe('grid');
    expect(parseProductsViewMode('list')).toBe('list');
    expect(parseProductsViewMode(null)).toBe('list');
    expect(parseProductsViewMode('tiles')).toBe('list');
  });

  it('round-trips through the store under one key', async () => {
    const mem = new Map<string, string>();
    const store = { getItem: async (k: string) => mem.get(k) ?? null, setItem: async (k: string, v: string) => { mem.set(k, v); } };
    expect(await loadProductsViewMode(store)).toBe('list');
    await saveProductsViewMode('grid', store);
    expect(mem.get(PRODUCTS_VIEW_MODE_KEY)).toBe('grid');
    expect(await loadProductsViewMode(store)).toBe('grid');
  });

  it('never throws when storage fails', async () => {
    const broken = { getItem: async () => { throw new Error('denied'); }, setItem: async () => { throw new Error('denied'); } };
    await expect(loadProductsViewMode(broken)).resolves.toBe('list');
    await expect(saveProductsViewMode('grid', broken)).resolves.toBeUndefined();
  });
});

describe('variant table input parsing', () => {
  it('keeps prices to digits, one dot and 2 decimals', () => {
    expect(sanitizePriceInput('$45.999')).toBe('45.99');
    expect(sanitizePriceInput('1.2.3')).toBe('1.23');
    expect(sanitizePriceInput('12')).toBe('12');
    expect(sanitizePriceInput('abc')).toBe('');
  });

  it('keeps stock to whole numbers', () => {
    expect(sanitizeStockInput('1,200 pcs')).toBe('1200');
    expect(sanitizeStockInput('-5')).toBe('5');
    expect(sanitizeStockInput('12345678')).toBe('123456');
  });

  it('parses price text to cents', () => {
    expect(parsePriceCents('45')).toBe(4500);
    expect(parsePriceCents('45.5')).toBe(4550);
    expect(parsePriceCents('0.10')).toBe(10);
    expect(parsePriceCents('0')).toBeNull();
    expect(parsePriceCents('')).toBeNull();
    expect(parsePriceCents('.')).toBeNull();
  });

  it('parses stock text to a whole number', () => {
    expect(parseStock('0')).toBe(0);
    expect(parseStock('12')).toBe(12);
    expect(parseStock('')).toBeNull();
  });
});
