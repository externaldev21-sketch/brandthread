import { describe, expect, it } from 'vitest';
import {
  dayGroupLabel, discountSummaryLine, discountUsageLine, groupDiscountsByDay, matchesDiscountFilter, matchesDiscountSearch,
  type DiscountSummaryInput,
} from './discountList';
import { buildPreviewDemoDiscounts, isPreviewDemoDiscountId } from './previewDiscounts';

const NOW = new Date(2026, 9, 9, 15, 0, 0);
const base: DiscountSummaryInput = {
  code: 'SAVE20', type: 'percentage', value: 20, minOrderCents: 0, appliesTo: 'entire_store', productIds: [], collectionIds: [],
  minQuantity: 0, maxUses: null, usesCount: 0, oneUsePerCustomer: false, firstOrderOnly: false, startsAt: null, expiresAt: null,
  status: 'active', createdAt: NOW.toISOString(),
};

describe('discountList', () => {
  it('builds the Shopify summary line', () => {
    expect(discountSummaryLine(base)).toBe('20% off all products');
    expect(discountSummaryLine({ ...base, type: 'free_shipping', minOrderCents: 10000 })).toBe('Free shipping on all products • Minimum purchase of $100.00');
    expect(discountSummaryLine({ ...base, type: 'fixed', value: 10, appliesTo: 'specific_products', productIds: ['p'], oneUsePerCustomer: true }))
      .toBe('$10.00 off 1 product • One use per customer');
    expect(discountSummaryLine({ ...base, appliesTo: 'collections', collectionIds: ['a', 'b'], minQuantity: 2, firstOrderOnly: true }))
      .toBe('20% off 2 collections • Minimum quantity of 2 items • First order only');
  });

  it('builds the usage line', () => {
    expect(discountUsageLine({ ...base, usesCount: 3, maxUses: 100 }, NOW)).toBe('3 of 100 used');
    expect(discountUsageLine({ ...base, usesCount: 4, expiresAt: new Date(2026, 9, 30).toISOString() }, NOW)).toBe('4 used • Ends Oct 30');
    expect(discountUsageLine({ ...base, startsAt: new Date(2026, 9, 12).toISOString() }, NOW)).toBe('0 used • Starts Oct 12');
    expect(discountUsageLine({ ...base, expiresAt: new Date(2025, 10, 30).toISOString() }, NOW)).toBe('0 used • Ended Nov 30, 2025');
  });

  it('filters like Shopify', () => {
    expect(matchesDiscountFilter('paused', 'all')).toBe(true);
    expect(matchesDiscountFilter('paused', 'active')).toBe(false);
    expect(matchesDiscountFilter('exhausted', 'expired')).toBe(true);
    expect(matchesDiscountFilter('scheduled', 'scheduled')).toBe(true);
    expect(matchesDiscountSearch('WELCOME15', 'come')).toBe(true);
    expect(matchesDiscountSearch('WELCOME15', 'ship')).toBe(false);
  });

  it('groups by created day, newest first', () => {
    expect(dayGroupLabel(NOW.toISOString(), NOW)).toBe('Today');
    expect(dayGroupLabel(new Date(2026, 9, 8, 23).toISOString(), NOW)).toBe('Yesterday');
    expect(dayGroupLabel(new Date(2026, 9, 1).toISOString(), NOW)).toBe('Oct 1');
    const groups = groupDiscountsByDay(buildPreviewDemoDiscounts(true, NOW), NOW);
    expect(groups[0].label).toBe('Today');
    expect(groups.flatMap((g) => g.items)).toHaveLength(6);
  });

  it('demo codes only exist with demo=1', () => {
    expect(buildPreviewDemoDiscounts(false, NOW)).toEqual([]);
    expect(buildPreviewDemoDiscounts(true, NOW).every((d) => isPreviewDemoDiscountId(d.id))).toBe(true);
  });
});
