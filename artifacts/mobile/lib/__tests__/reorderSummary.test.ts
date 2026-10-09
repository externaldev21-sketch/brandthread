import { describe, expect, it } from 'vitest';
import {
  canReorderStatus,
  priceChangeNote,
  reorderNeedsReview,
  summarizeReorder,
  unavailableReasonLabel,
  type ReorderOutcome,
} from '../reorderSummary';

const outcome = (over: Partial<ReorderOutcome> = {}): ReorderOutcome => ({
  addedUnits: 0, addedLines: 0, unavailable: [], priceChanges: [], reducedQuantityTitles: [], ...over,
});
const gone = { productId: null, title: 'Old Scarf', reason: 'discontinued' as const };

describe('summarizeReorder', () => {
  it('reads "3 items added · 1 unavailable" for a partial reorder', () => {
    expect(summarizeReorder(outcome({ addedUnits: 3, unavailable: [gone] }))).toBe('3 items added · 1 unavailable');
  });
  it('uses the singular for one item and omits the tail when nothing is unavailable', () => {
    expect(summarizeReorder(outcome({ addedUnits: 1 }))).toBe('1 item added');
  });
  it('says nothing was added when every line is unavailable', () => {
    expect(summarizeReorder(outcome({ unavailable: [gone, gone] }))).toBe('Nothing to reorder · 2 unavailable');
    expect(summarizeReorder(outcome())).toBe('Nothing to reorder');
  });
});

describe('reorder review state', () => {
  it('needs review only when something is unavailable, repriced or reduced', () => {
    expect(reorderNeedsReview(outcome({ addedUnits: 2 }))).toBe(false);
    expect(reorderNeedsReview(outcome({ unavailable: [gone] }))).toBe(true);
    expect(reorderNeedsReview(outcome({ priceChanges: [{ title: 'Tee', previousPriceCents: 4000, currentPriceCents: 4500 }] }))).toBe(true);
    expect(reorderNeedsReview(outcome({ reducedQuantityTitles: ['Tee'] }))).toBe(true);
  });
  it('words reasons and price changes', () => {
    expect(unavailableReasonLabel('out_of_stock')).toBe('Out of stock');
    expect(unavailableReasonLabel('discontinued')).toBe('No longer sold');
    expect(unavailableReasonLabel('variant_removed')).toMatch(/no longer offered/);
    expect(priceChangeNote({ previousPriceCents: 4000, currentPriceCents: 4500 })).toBe('Now $45.00 (was $40.00)');
  });
  it('offers Reorder only for delivered orders', () => {
    expect(canReorderStatus('delivered')).toBe(true);
    for (const s of ['new', 'processing', 'shipped', 'cancelled', 'refunded', 'disputed']) {
      expect(canReorderStatus(s)).toBe(false);
    }
  });
});
