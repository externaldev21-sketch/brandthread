import { describe, expect, it } from 'vitest';
import {
  countUnreadBuyerThreads,
  countPendingReturns,
  countSoldOrders,
  countUnreadBuyerMessages,
  deriveDashboardSecondary,
  deriveHubStats,
  deriveInventoryStats,
  deriveOrderStats,
  describeDashboardDelta,
  hasNoActionNeeded,
  isNewSeller,
  mergeTopProductImages,
  normalizeRecentOrder,
} from './sellerDashboardStats';
import { formatCents } from './money';

describe('seller dashboard stats', () => {
  it('returns honest zeros for a brand-new seller', () => {
    expect(deriveOrderStats([])).toEqual({
      newOrders: 0, toProcess: 0, readyToShip: 0,
    });
    expect(deriveInventoryStats([])).toEqual({
      lowStockCount: 0, outOfStockCount: 0, incomingCount: 0, delayedCount: 0,
    });
    expect(deriveHubStats([], [], [])).toEqual({
      activeQuotes: 0, samplesNeedingReview: 0, activeProduction: 0, unreadMessages: 0,
    });
  });

  it('derives non-zero values only from supplied real records', () => {
    const orderPayload = [
      { id: 'order-pending', status: 'pending', totalCents: 4200 },
      { id: 'order-packed', status: 'fulfilled', totalCents: 8100 },
      { id: 'order-processing', status: 'processing', totalCents: 1500 },
    ];
    expect(deriveOrderStats(orderPayload)).toEqual({
      newOrders: 1, toProcess: 1, readyToShip: 1,
    });
    expect(deriveInventoryStats([{ variantId: 'v1', stock: 0 }, { variantId: 'v2', stock: 2, lowStockThreshold: 4 }])).toMatchObject({
      outOfStockCount: 1, lowStockCount: 1,
    });
    expect(deriveHubStats(
      [{ id: 'quote-1', status: 'sent' }],
      [{ id: 'sample-review', status: 'review_needed' }, { id: 'sample-production', status: 'cut_and_sew' }],
      [{ id: 'thread-1', unreadCount: 2 }],
    )).toMatchObject({
      activeQuotes: 1, samplesNeedingReview: 1, activeProduction: 1, unreadMessages: 2,
    });
  });
});

describe('describeDashboardDelta', () => {
  it('renders a positive delta with real amount and percent', () => {
    const delta = describeDashboardDelta(16_200, 15_000, formatCents);
    expect(delta.direction).toBe('up');
    expect(delta.label).toBe('$12.00 (8%) vs last period');
  });

  it('renders a negative delta as an unsigned magnitude; direction carries the down arrow', () => {
    const delta = describeDashboardDelta(9_000, 12_000, formatCents);
    expect(delta.direction).toBe('down');
    expect(delta.label).toBe('$30.00 (25%) vs last period');
  });

  it('renders a neutral, non-alarming line for a true zero delta', () => {
    const delta = describeDashboardDelta(5_000, 5_000, formatCents);
    expect(delta.direction).toBe('flat');
    expect(delta.label).toBe('No change vs last period');
  });

  it('renders a zero-vs-zero delta the same neutral way (brand-new seller)', () => {
    const delta = describeDashboardDelta(0, 0, formatCents);
    expect(delta.direction).toBe('flat');
    expect(delta.label).toBe('No change vs last period');
  });

  it('never claims a percent when the previous period was zero and current is not', () => {
    const delta = describeDashboardDelta(4_200, 0, formatCents);
    expect(delta.direction).toBe('up');
    expect(delta.label).toBe('$42.00 vs last period');
    expect(delta.label).not.toContain('%');
  });

  it('accepts a custom period label and plain-count formatter', () => {
    const delta = describeDashboardDelta(12, 10, (n) => String(n), 'last week');
    expect(delta.label).toBe('2 (20%) vs last week');
  });
});

describe('hasNoActionNeeded / countPendingReturns', () => {
  it('is true only when every action count is zero', () => {
    expect(hasNoActionNeeded({ toShip: 0, toAnswer: 0, lowStock: 0, returns: 0 })).toBe(true);
    expect(hasNoActionNeeded({ toShip: 1, toAnswer: 0, lowStock: 0, returns: 0 })).toBe(false);
    expect(hasNoActionNeeded({ toShip: 0, toAnswer: 0, lowStock: 0, returns: 2 })).toBe(false);
  });

  it('counts return requests still awaiting a decision (GET /api/returns status pending)', () => {
    const rows = [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'approved' },
      { id: 'c', status: 'refunded' },
      { id: 'd', status: 'pending' },
    ];
    expect(countPendingReturns(rows)).toBe(2);
  });
});

describe('dashboard secondary numbers', () => {
  it('counts unread buyer messages by the inbox rule (no requests, archived or buyer↔buyer)', () => {
    expect(countUnreadBuyerMessages([
      { unreadCount: 2 },
      { unreadCount: 3, isRequest: true },
      { unreadCount: 1, isArchived: true },
      { unreadCount: 4, type: 'buyer_to_buyer' },
      { unreadCount: 1, type: 'buyer_to_seller' },
    ])).toBe(3);
  });

  it('only counts paid, non-cancelled orders as sold', () => {
    expect(countSoldOrders([
      { paidAt: '2026-10-01T00:00:00Z', status: 'pending' },
      { paidAt: null, status: 'pending' },
      { paidAt: '2026-10-01T00:00:00Z', status: 'cancelled' },
    ])).toBe(1);
  });

  it('derives every below-the-hero number from the source responses', () => {
    const out = deriveDashboardSecondary({
      orders: [
        { id: 'o2', orderNumber: '#1002', customerName: 'Ana', itemCount: 2, totalCents: 5000, status: 'pending', paidAt: '2026-10-02T00:00:00Z' },
        { id: 'o1', orderNumber: '#1001', customerName: 'Ben', itemCount: 1, totalCents: 2000, status: 'cancelled', paidAt: null },
      ],
      toShip: 1,
      productAnalytics: [
        { productId: 'p1', name: 'Coat', unitsSold: 2, revenueCents: 4000 },
        { productId: 'p2', name: 'Unsold', unitsSold: 0, revenueCents: 0 },
      ],
      catalog: [{ id: 'p1', images: ['https://img/coat.jpg'] }],
      lowStockCount: 3,
      returns: [{ status: 'pending' }, { status: 'denied' }],
      conversations: [{ unreadCount: 2 }],
      quotes: [],
      samples: [],
      threads: [{ unreadCount: 1 }],
    });
    expect(out.everSoldCount).toBe(1);
    expect(out.recentOrders.map((o) => o.orderNumber)).toEqual(['#1002', '#1001']);
    expect(out.topProducts).toEqual([{ productId: 'p1', name: 'Coat', unitsSold: 2, revenueCents: 4000, imageUrl: 'https://img/coat.jpg' }]);
    expect(out.actionInputs).toEqual({ unreadMessages: 3, lowStockCount: 3, returns: 1, toShip: 1 });
  });
});

describe('isNewSeller', () => {
  it('is true only for a seller with zero real orders ever', () => {
    expect(isNewSeller(0)).toBe(true);
    expect(isNewSeller(1)).toBe(false);
  });
});

describe('mergeTopProductImages', () => {
  it('attaches a real catalog image by id and never fabricates one', () => {
    const products = [
      { productId: 'p1', name: 'Tee', unitsSold: 4, revenueCents: 8000 },
      { productId: 'p2', name: 'Hoodie', unitsSold: 2, revenueCents: 12000 },
    ];
    const catalog = [
      { id: 'p1', images: ['https://cdn.example.com/p1.jpg'] },
      { id: 'p2', images: [] },
    ];
    const merged = mergeTopProductImages(products, catalog);
    expect(merged[0].imageUrl).toBe('https://cdn.example.com/p1.jpg');
    expect(merged[1].imageUrl).toBeNull();
  });
});

describe('normalizeRecentOrder', () => {
  it("reads the orders list's server-side itemCount", () => {
    expect(normalizeRecentOrder({ id: 'ord_1', itemCount: 3, totalCents: 100, status: 'pending', orderNumber: 'BT-00001' }).itemCount).toBe(3);
    expect(normalizeRecentOrder({ id: 'ord_2', items: [{}, {}], totalCents: 100, status: 'pending' }).itemCount).toBe(2);
  });

  it('falls back through known field name variants without inventing data', () => {
    const order = { id: 'order_123456', total_cents: 4599, status: 'processing', lineItems: [{}, {}] };
    expect(normalizeRecentOrder(order)).toEqual({
      id: 'order_123456',
      buyerName: 'Unknown',
      itemCount: 2,
      totalCents: 4599,
      status: 'processing',
      orderNumber: '#123456',
    });
  });
});

describe('countUnreadBuyerThreads (dashboard Messages badge)', () => {
  it('counts threads with anything unread, not messages', () => {
    expect(countUnreadBuyerThreads([
      { id: 'a', unreadCount: 5 },
      { id: 'b', unreadCount: 1 },
      { id: 'c', unreadCount: 0 },
    ])).toBe(2);
  });
  it('skips buyer↔buyer, requests and archived, like the inbox header', () => {
    expect(countUnreadBuyerThreads([
      { id: 'a', unreadCount: 2, type: 'buyer_to_buyer' },
      { id: 'b', unreadCount: 2, isRequest: true },
      { id: 'c', unreadCount: 2, isArchived: true },
      null,
      { id: 'd', unreadCount: '3' },
    ])).toBe(1);
  });
});
