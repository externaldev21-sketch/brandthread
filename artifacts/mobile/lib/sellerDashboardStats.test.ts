import { describe, expect, it } from 'vitest';
import { deriveHubStats, deriveInventoryStats, deriveOrderStats } from './sellerDashboardStats';

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
