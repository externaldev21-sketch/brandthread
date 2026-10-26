import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-asset', () => ({ Asset: { fromModule: () => ({ uri: 'asset://poster.jpg' }) } }));

import { apiDashboardSource, previewDashboardSource, previewProductAnalytics } from './sellerDashboardSource';

describe('previewProductAnalytics (the API /analytics/products rule)', () => {
  it('sums line revenue of paid, non-cancelled orders only, sorted by revenue', () => {
    const rows = previewProductAnalytics(
      [
        { paidAt: 'x', status: 'shipped', items: [{ productId: 'a', productName: 'A', quantity: 2, priceCents: 1000 }] },
        { paidAt: 'x', status: 'pending', items: [{ productId: 'b', productName: 'B', quantity: 1, priceCents: 5000 }, { productId: 'a', productName: 'A', quantity: 1, priceCents: 1000 }] },
        { paidAt: null, status: 'cancelled', items: [{ productId: 'b', productName: 'B', quantity: 9, priceCents: 5000 }] },
      ],
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'Never sold' }],
    );
    expect(rows.map((r) => [r.productId, r.revenueCents, r.unitsSold, r.orderCount])).toEqual([
      ['b', 5000, 1, 1],
      ['a', 3000, 3, 2],
      ['c', 0, 0, 0],
    ]);
  });
});

describe('dashboard sources answer the same calls', () => {
  it('preview: same method set as the API source, no network', async () => {
    const api = new Proxy({}, { get: () => { throw new Error('preview must not touch the API'); } });
    const preview = previewDashboardSource('fresh', () => new Date(2026, 9, 26, 12));
    const real = apiDashboardSource(api as never);
    expect(Object.keys(preview).sort()).toEqual(Object.keys(real).sort());
    expect(await preview.orders()).toEqual([]);
    expect(await preview.returns()).toEqual([]);
    const home = await preview.analyticsHome('today');
    expect(home.totalCents).toBe(0);
    expect(home.previous.totalCents).toBe(0);
  });

  it('demo: orders, top products and today’s analytics agree with each other', async () => {
    const now = new Date(2026, 9, 26, 15, 30);
    const demo = previewDashboardSource('demo', () => now);
    const [orders, top, home] = await Promise.all([demo.orders(), demo.productAnalytics(), demo.analyticsHome('today')]);
    const isToday = (iso: string) => new Date(iso).toDateString() === now.toDateString();
    const todaysSales = orders.filter((o) => isToday(o.createdAt) && o.paidAt && o.status !== 'cancelled');
    expect(home.orderCount).toBe(todaysSales.length);
    expect(home.totalCents).toBe(todaysSales.reduce((sum: number, o: { totalCents: number }) => sum + o.totalCents, 0));
    expect(top[0].revenueCents).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i += 1) expect(top[i - 1].revenueCents).toBeGreaterThanOrEqual(top[i].revenueCents);
  });
});
