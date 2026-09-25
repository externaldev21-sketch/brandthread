import { describe, expect, it } from 'vitest';
import {
  countOrderReturns,
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
    expect(delta.label).toBe('+$12.00 (8%) vs last period');
  });

  it('renders a negative delta with a minus sign and magnitude only (no double negative)', () => {
    const delta = describeDashboardDelta(9_000, 12_000, formatCents);
    expect(delta.direction).toBe('down');
    expect(delta.label).toBe('-$30.00 (25%) vs last period');
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
    expect(delta.label).toBe('+$42.00 vs last period');
    expect(delta.label).not.toContain('%');
  });

  it('accepts a custom period label and plain-count formatter', () => {
    const delta = describeDashboardDelta(12, 10, (n) => String(n), 'last week');
    expect(delta.label).toBe('+2 (20%) vs last week');
  });
});

describe('hasNoActionNeeded / countOrderReturns', () => {
  it('is true only when every action count is zero', () => {
    expect(hasNoActionNeeded({ toShip: 0, toAnswer: 0, lowStock: 0, returns: 0 })).toBe(true);
    expect(hasNoActionNeeded({ toShip: 1, toAnswer: 0, lowStock: 0, returns: 0 })).toBe(false);
    expect(hasNoActionNeeded({ toShip: 0, toAnswer: 0, lowStock: 0, returns: 2 })).toBe(false);
  });

  it('counts only orders with a real, non-empty returns array', () => {
    const rows = [
      { id: 'a', returns: [{ id: 'r1' }] },
      { id: 'b', returns: [] },
      { id: 'c' },
    ];
    expect(countOrderReturns(rows)).toBe(1);
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
