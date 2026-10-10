import { describe, expect, it } from 'vitest';
import { customerLocation, customerSpendLine, matchesCustomerSearch, ordersLabel, sortCustomers } from './sellerCustomers';
import { buildPreviewCustomers, getPreviewCustomerDetail } from './previewCustomers';
import { previewSellerOrders } from './previewSellerOrders';
import { previewDemoSearch } from './previewDemoSearch';

const NOW = new Date(2026, 9, 9, 15, 0, 0);

describe('sellerCustomers helpers', () => {
  it('builds the Shopify row lines', () => {
    expect(customerLocation({ city: 'Austin', state: 'TX', country: 'US' })).toBe('Austin, TX');
    expect(customerLocation({ city: 'Singapore', country: 'SG' })).toBe('Singapore, SG');
    expect(customerLocation(null)).toBeNull();
    expect(customerLocation({ city: '', state: '' })).toBeNull();
    expect(customerSpendLine({ totalSpentCents: 17493, orderCount: 2 })).toBe('$174.93 • 2 orders');
    expect(ordersLabel(1)).toBe('1 order');
  });

  it('sorts and searches', () => {
    const list = [
      { id: 'a', name: 'Zoe', email: 'z@x.com', totalSpentCents: 100, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', name: 'Ava', email: 'ava@x.com', totalSpentCents: 900, createdAt: '2026-03-01T00:00:00Z' },
    ];
    expect(sortCustomers(list, 'recent').map((c) => c.id)).toEqual(['b', 'a']);
    expect(sortCustomers(list, 'spend').map((c) => c.id)).toEqual(['b', 'a']);
    expect(sortCustomers(list, 'name').map((c) => c.id)).toEqual(['b', 'a']);
    expect(matchesCustomerSearch(list[0], 'Z@X')).toBe(true);
    expect(matchesCustomerSearch(list[0], 'ava')).toBe(false);
  });
});

describe('preview customers', () => {
  it('fresh preview has no customers', () => {
    expect(buildPreviewCustomers(false, NOW)).toEqual([]);
    expect(getPreviewCustomerDetail('preview-customer-x', false, NOW)).toBeNull();
  });

  it('demo customers add up to the demo orders they come from', () => {
    const customers = buildPreviewCustomers(true, NOW);
    expect(customers.length).toBeGreaterThan(3);
    const paid = previewSellerOrders(NOW, 400).filter((o) => o.status !== 'cancelled');
    expect(customers.reduce((n, c) => n + (c.orderCount ?? 0), 0)).toBe(paid.length);
    const first = customers[0];
    const detail = getPreviewCustomerDetail(first.id, true, NOW)!;
    expect(detail.orders).toHaveLength(first.orderCount!);
    expect(detail.orders.reduce((n, o) => n + o.totalCents, 0)).toBe(first.totalSpentCents);
  });
});

describe('previewDemoSearch', () => {
  it('only rebuilds a demo query when the route carries both flags', () => {
    expect(previewDemoSearch({ bt_preview: 'seller', demo: '1' })).toBe('?bt_preview=seller&demo=1');
    expect(previewDemoSearch({ bt_preview: 'seller' })).toBeUndefined();
    expect(previewDemoSearch({ demo: '1' })).toBeUndefined();
    expect(previewDemoSearch({ bt_preview: ['seller'], demo: ['0'] })).toBeUndefined();
  });
});
