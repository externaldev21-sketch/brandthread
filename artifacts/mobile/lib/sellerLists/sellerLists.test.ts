import { describe, expect, it } from 'vitest';
import {
  ORDER_EMPTY_FILTERS, PRODUCT_EMPTY_FILTERS, orderEmptyCopy, productEmptyCopy,
} from './emptyCopy';
import { PRODUCT_SORT_OPTIONS, productSortLabel, productSortQuery } from './productSort';
import { chipCenterOffset, chipSnapOffsets, visibleChipCount } from './chipRailGeometry';

describe('productEmptyCopy', () => {
  it('matches the selected filter with a single honest title', () => {
    expect(productEmptyCopy('all')).toEqual({ icon: 'package', title: 'No products yet', action: 'add-product' });
    expect(productEmptyCopy('active')).toEqual({ icon: 'check-circle', title: 'No active products', action: 'add-product' });
    expect(productEmptyCopy('draft').title).toBe('No drafts');
    expect(productEmptyCopy('archived').title).toBe('No archived products');
  });

  it('offers Add product only on All and Active', () => {
    const withAction = PRODUCT_EMPTY_FILTERS.filter((f) => productEmptyCopy(f).action);
    expect(withAction.sort()).toEqual(['active', 'all']);
    expect(productEmptyCopy('archived').action).toBeUndefined();
    expect(productEmptyCopy('draft').action).toBeUndefined();
  });

  it('says "no matching" for an empty search, never "no products yet"', () => {
    expect(productEmptyCopy('all', 'tee')).toEqual({ icon: 'search', title: 'No matching products' });
    expect(productEmptyCopy('active', '  ')).toEqual(productEmptyCopy('active'));
  });

  it('falls back to All for an unknown filter', () => {
    expect(productEmptyCopy('bogus')).toEqual(productEmptyCopy('all'));
  });
});

describe('orderEmptyCopy', () => {
  it('names each status chip and sheet filter, with no action', () => {
    expect(orderEmptyCopy('all').title).toBe('No orders yet');
    expect(orderEmptyCopy('unfulfilled').title).toBe('No unfulfilled orders');
    expect(orderEmptyCopy('unpaid').title).toBe('No unpaid orders');
    expect(orderEmptyCopy('open').title).toBe('No open orders');
    expect(orderEmptyCopy('archived').title).toBe('No archived orders');
    expect(orderEmptyCopy('returned').title).toBe('No returns');
    for (const f of ORDER_EMPTY_FILTERS) expect(orderEmptyCopy(f).action).toBeUndefined();
  });

  it('covers every OrderFilterKey plus the three list-only chips', () => {
    const keys = [
      'all', 'new', 'unfulfilled', 'partially_fulfilled', 'processing', 'ready_to_ship', 'shipped',
      'delivered', 'cancelled', 'refunded', 'returned', 'pre_order', 'manufacturer_fulfilled',
      'seller_fulfilled', 'high_risk', 'disputed', 'unpaid', 'open', 'archived',
    ];
    expect([...ORDER_EMPTY_FILTERS].sort()).toEqual([...keys].sort());
  });

  it('says "no matching" for an empty search', () => {
    expect(orderEmptyCopy('unpaid', 'maya')).toEqual({ icon: 'search', title: 'No matching orders' });
  });

  it('keeps every title short enough to sit on one line at 393px', () => {
    // EmptyState titles are ≤320px wide at 20px bold ≈ 28 characters.
    for (const f of [...ORDER_EMPTY_FILTERS]) expect(orderEmptyCopy(f).title.length).toBeLessThanOrEqual(28);
    for (const f of [...PRODUCT_EMPTY_FILTERS]) expect(productEmptyCopy(f).title.length).toBeLessThanOrEqual(28);
  });
});

describe('product sort', () => {
  it('lists exactly the five options Dev specified, in order', () => {
    expect(PRODUCT_SORT_OPTIONS.map((o) => o.label)).toEqual([
      'Newest', 'Oldest', 'Price: high to low', 'Price: low to high', 'Best selling',
    ]);
  });

  it('maps each option to the real query sortBy / sortDir', () => {
    expect(productSortQuery('newest')).toEqual({ sortBy: 'createdAt', sortDir: 'desc' });
    expect(productSortQuery('oldest')).toEqual({ sortBy: 'createdAt', sortDir: 'asc' });
    expect(productSortQuery('price_desc')).toEqual({ sortBy: 'price', sortDir: 'desc' });
    expect(productSortQuery('price_asc')).toEqual({ sortBy: 'price', sortDir: 'asc' });
    expect(productSortQuery('sales')).toEqual({ sortBy: 'sales', sortDir: 'desc' });
    expect(productSortLabel('sales')).toBe('Best selling');
  });
});

describe('ChipRail geometry', () => {
  // Pure helpers only — the component itself is exercised by the e2e spec.

  it('snaps each chip leading edge to the 16px gutter; first chip at 0', () => {
    expect(chipSnapOffsets([{ x: 16 }, { x: 70 }, { x: 160 }])).toEqual([0, 54, 144]);
    // Inset viewport (ChipRail): content starts at 0.
    expect(chipSnapOffsets([{ x: 0 }, { x: 54 }, { x: 144 }], 0)).toEqual([0, 54, 144]);
  });

  it('centres a tapped chip, clamped to the scrollable range', () => {
    expect(chipCenterOffset({ x: 16, width: 50 }, 393, 700)).toBe(0);
    expect(chipCenterOffset({ x: 300, width: 100 }, 393, 700)).toBe(154);
    expect(chipCenterOffset({ x: 600, width: 84 }, 393, 700)).toBe(307);
  });

  it('hides a zero count badge', () => {
    expect(visibleChipCount(0)).toBeUndefined();
    expect(visibleChipCount(undefined)).toBeUndefined();
    expect(visibleChipCount(3)).toBe(3);
  });
});
