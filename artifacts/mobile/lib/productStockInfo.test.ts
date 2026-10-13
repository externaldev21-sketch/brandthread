import { describe, expect, it, vi } from 'vitest';
import { createSoldOutLookup, tagPriceLabel } from './productStockInfo';

describe('tagPriceLabel', () => {
  it('shows the price while in stock or unknown', () => {
    expect(tagPriceLabel(22000, false)).toBe('$220.00');
  });
  it('shows "Sold out" instead of the price when sold out', () => {
    expect(tagPriceLabel(22000, true)).toBe('Sold out');
  });
});

describe('createSoldOutLookup', () => {
  it('reads soldOut from the stock-info payload', async () => {
    const lookup = createSoldOutLookup(async (id) => ({ soldOut: id === 'gone', limited: false, editionSize: null, remaining: null }));
    expect(await lookup.get('gone')).toBe(true);
    expect(await lookup.get('here')).toBe(false);
  });

  it('fetches each product once', async () => {
    const fetcher = vi.fn(async () => ({ soldOut: false }));
    const lookup = createSoldOutLookup(fetcher);
    await Promise.all([lookup.get('a'), lookup.get('a'), lookup.get('a')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(lookup.peek('a')).toBeDefined();
  });

  it('treats failures and malformed payloads as unknown (null), never as sold out', async () => {
    expect(await createSoldOutLookup(async () => { throw new Error('404'); }).get('x')).toBeNull();
    expect(await createSoldOutLookup(async () => null).get('x')).toBeNull();
    expect(await createSoldOutLookup(async () => ({ soldOut: 'yes' })).get('x')).toBeNull();
  });
});
