import { describe, expect, it } from 'vitest';
import {
  centsToPriceText, clampPercent, previewWholesaleCents, priceTextToCents, productRowDetail, productsSummary,
  type WholesalePrice, type WholesaleProduct,
} from './wholesale';

const product = (id: string, priceCents: number): WholesaleProduct => ({ id, name: id, image: null, variants: [{ id: `${id}-v`, label: 'M', priceCents }] });

describe('wholesale helpers', () => {
  it('parses price text, allowing zero', () => {
    expect(priceTextToCents('120')).toBe(12_000);
    expect(priceTextToCents('$1,200.50')).toBe(120_050);
    expect(priceTextToCents('0')).toBe(0);
    expect(priceTextToCents('12.345')).toBeNull();
    expect(priceTextToCents('abc')).toBeNull();
  });

  it('formats cents back to field text', () => {
    expect(centsToPriceText(null)).toBe('');
    expect(centsToPriceText(12_000)).toBe('120');
    expect(centsToPriceText(1_250)).toBe('12.50');
  });

  it('clamps the default discount to 0..90', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(95)).toBe(90);
    expect(clampPercent(NaN)).toBe(0);
  });

  it('previews the wholesale price like the server', () => {
    expect(previewWholesaleCents({ defaultPercentOff: 40 }, undefined, 5_000)).toBe(3_000);
    expect(previewWholesaleCents({ defaultPercentOff: 40 }, { priceCents: 2_000 }, 5_000)).toBe(2_000);
    expect(previewWholesaleCents({ defaultPercentOff: 0 }, undefined, 5_000)).toBeNull();
  });

  it('describes product rows and the products summary', () => {
    const settings = { enabled: true, minOrderCents: 0, defaultPercentOff: 40 };
    const prices: WholesalePrice[] = [{ id: 'r', productId: 'cap', variantId: null, priceCents: 900, minQuantity: 6 }];
    expect(productRowDetail(settings, prices, product('tee', 5_000))).toBe('$30.00 · 40% off');
    expect(productRowDetail(settings, prices, product('cap', 2_000))).toBe('$9.00 · Min. 6 · Fixed price');
    expect(productRowDetail({ ...settings, defaultPercentOff: 0 }, [], product('tee', 5_000))).toBe('Retail price · No discount');
    expect(productsSummary([product('tee', 1), product('cap', 1)], prices)).toBe('2 products · 1 fixed price');
    expect(productsSummary([product('tee', 1)], [])).toBe('1 product · No fixed prices');
  });
});
