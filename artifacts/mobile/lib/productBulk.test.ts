import { describe, expect, it } from 'vitest';
import { buildPriceChange, buildStockChange, bulkErrorMessage, priceRangeLabel } from './productBulk';

describe('buildPriceChange', () => {
  it('converts percent to basis points', () => {
    expect(buildPriceChange('percent_down', '10')).toEqual({ mode: 'percent', direction: 'decrease', value: 1000 });
    expect(buildPriceChange('percent_up', '12.5')).toEqual({ mode: 'percent', direction: 'increase', value: 1250 });
  });
  it('converts dollars to cents', () => {
    expect(buildPriceChange('set', '39.99')).toEqual({ mode: 'set', value: 3999 });
    expect(buildPriceChange('amount_down', '5')).toEqual({ mode: 'amount', direction: 'decrease', value: 500 });
  });
  it('rejects empty, zero, malformed and over-100% discounts', () => {
    for (const [mode, input] of [
      ['set', ''], ['set', '0'], ['set', 'abc'], ['percent_down', '0'], ['percent_down', '101'], ['percent_up', '1.234'],
    ] as const) expect(buildPriceChange(mode, input)).toBeNull();
  });
});

describe('bulkErrorMessage', () => {
  it('maps known server codes to friendly text', () => {
    const err = (body: object) => ({ body: JSON.stringify(body) });
    expect(bulkErrorMessage(err({ code: 'PRODUCT_MODERATION_LOCKED' }), 'x')).toMatch(/moderation/);
    expect(bulkErrorMessage(err({ code: 'PLAN_LIMIT_REACHED', message: 'Upgrade to add more.' }), 'x')).toBe('Upgrade to add more.');
    expect(bulkErrorMessage(err({ error: 'Nope' }), 'x')).toBe('Nope');
    expect(bulkErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('priceRangeLabel', () => {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  it('collapses equal bounds', () => {
    expect(priceRangeLabel(1000, 1000, fmt)).toBe('$10.00');
    expect(priceRangeLabel(1000, 2000, fmt)).toBe('$10.00 – $20.00');
    expect(priceRangeLabel(null, null, fmt)).toBe('No price');
  });
});

describe('buildStockChange', () => {
  it('builds set / add / remove from whole numbers', () => {
    expect(buildStockChange('set', '0')).toEqual({ mode: 'set', value: 0 });
    expect(buildStockChange('add', ' 12 ')).toEqual({ mode: 'add', value: 12 });
    expect(buildStockChange('remove', '3')).toEqual({ mode: 'remove', value: 3 });
  });

  it('refuses empty, fractional, negative, no-op and huge quantities', () => {
    expect(buildStockChange('set', '')).toBeNull();
    expect(buildStockChange('set', '1.5')).toBeNull();
    expect(buildStockChange('set', '-2')).toBeNull();
    expect(buildStockChange('add', '0')).toBeNull();
    expect(buildStockChange('set', '1000001')).toBeNull();
  });
});
