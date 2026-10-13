import { describe, expect, it } from 'vitest';
import { stockCounterText, variantStockLine, type StockInfo } from '../stockLine';

const none: StockInfo = { soldOut: false, limited: false, editionSize: null, remaining: null, counterThreshold: null };
const v = (inventoryQuantity: number, isAvailable = inventoryQuantity > 0) => ({ inventoryQuantity, isAvailable });

describe('variantStockLine', () => {
  it('uses 5 when the seller set no threshold (or stock-info is unavailable)', () => {
    expect(variantStockLine(v(5), none)).toEqual({ kind: 'low', text: 'Only 5 left in stock' });
    expect(variantStockLine(v(6), none).kind).toBe('in');
    expect(variantStockLine(v(2), null)).toEqual({ kind: 'low', text: 'Only 2 left in stock' });
  });

  it("uses the seller's opted-in threshold", () => {
    const info = { ...none, counterThreshold: 10 };
    expect(variantStockLine(v(9), info)).toEqual({ kind: 'low', text: 'Only 9 left in stock' });
    expect(variantStockLine(v(4), { ...none, counterThreshold: 3 }).kind).toBe('in');
  });

  it('hides when the stock counter already states the stock', () => {
    expect(variantStockLine(v(2), { ...none, remaining: 4, counterThreshold: 5 }).kind).toBe('hidden');
    expect(variantStockLine(v(0), { ...none, soldOut: true }).kind).toBe('hidden');
    expect(variantStockLine(v(8), { ...none, limited: true, editionSize: 50, remaining: 12 }).kind).toBe('hidden');
  });

  it('still says a size is out while the product has stock', () => {
    expect(variantStockLine(v(0), { ...none, remaining: 4 })).toEqual({ kind: 'out', text: 'Out of stock — select another option' });
    expect(variantStockLine(v(0), none).kind).toBe('out');
  });
});

describe('stockCounterText', () => {
  it('matches the counter pill', () => {
    expect(stockCounterText(none)).toBeNull();
    expect(stockCounterText({ ...none, remaining: 1 })).toBe('Only 1 left');
    expect(stockCounterText({ ...none, soldOut: true })).toBe('Sold out');
  });
});
