import { describe, expect, it } from 'vitest';
import {
  HOME_DASHBOARD_RANGES,
  datedNextPayout,
  describeHomeDelta,
  groupBucketsByWeek,
  hasTodo,
  mergeDashboardActivity,
  payoutProgress,
  shortRelativeTime,
} from '@/lib/sellerDashboardHome';
import { buildPreviewSellerAnalytics } from '@/lib/previewSellerChartData';
import { bucketLabel } from '@/lib/sellerHomeChartLabels';

const NOW = Date.parse('2026-10-13T18:00:00.000Z');

describe('Dashboard range set', () => {
  it('is Today / 7D / 30D / 90D, in order', () => {
    expect(HOME_DASHBOARD_RANGES.map((r) => r.label)).toEqual(['Today', '7D', '30D', '90D']);
    expect(HOME_DASHBOARD_RANGES.map((r) => r.id)).toEqual(['today', '7d', '30d', '90d']);
  });

  it('preview data has one daily bucket per day of each rolling window, ending today', () => {
    const now = new Date(2026, 9, 13, 11, 0);
    for (const [range, days] of [['7d', 7], ['30d', 30], ['90d', 90]] as const) {
      for (const mode of ['fresh', 'demo'] as const) {
        const data = buildPreviewSellerAnalytics(range, mode, now);
        expect(data.buckets).toHaveLength(days);
        const last = new Date(data.buckets[days - 1].bucket);
        expect([last.getFullYear(), last.getMonth(), last.getDate()]).toEqual([2026, 9, 13]);
      }
    }
  });

  it('demo rolling ranges compare against the real prior window, fresh ranges against zero', () => {
    const now = new Date(2026, 9, 13, 11, 0);
    expect(buildPreviewSellerAnalytics('30d', 'fresh', now).previous.totalCents).toBe(0);
    const demo = buildPreviewSellerAnalytics('30d', 'demo', now);
    expect(demo.totalCents).toBeGreaterThan(0);
    expect(demo.previous.totalCents).toBeGreaterThan(0);
    expect(demo.totalCents).toBe(demo.buckets.reduce((s, b) => s + b.totalCents, 0));
  });

  it('labels 7D buckets by weekday and 30D/90D buckets by date', () => {
    const iso = new Date(2026, 9, 13).toISOString();
    expect(bucketLabel(iso, '7d')).toBe('Tue');
    expect(bucketLabel(iso, '30d')).toBe('Oct 13');
    expect(bucketLabel(iso, '90d')).toBe('Oct 13');
  });
});

describe('groupBucketsByWeek (90D chart points)', () => {
  it('folds 90 daily buckets into 13 points from the newest day back, with exact sums', () => {
    const daily = Array.from({ length: 90 }, (_, i) => ({
      bucket: new Date(2026, 6, 16 + i).toISOString(), totalCents: 100 + i, netCents: 90, orderCount: 1, visitorCount: 3,
    }));
    const weekly = groupBucketsByWeek(daily);
    expect(weekly).toHaveLength(13);
    expect(weekly[0].orderCount).toBe(6); // oldest point covers the 6 leftover days
    expect(weekly[12].orderCount).toBe(7);
    expect(weekly[12].bucket).toBe(daily[83].bucket);
    expect(weekly.reduce((s, b) => s + b.totalCents, 0)).toBe(daily.reduce((s, b) => s + b.totalCents, 0));
  });
});

describe('describeHomeDelta', () => {
  it('shows a signed percent with the range comparison', () => {
    expect(describeHomeDelta(112, 100, 'today')).toEqual({ direction: 'up', label: '12% vs yesterday' });
    expect(describeHomeDelta(90, 100, '7d')).toEqual({ direction: 'down', label: '10% vs previous 7 days' });
    expect(describeHomeDelta(100, 100, '90d')).toEqual({ direction: 'flat', label: '0% vs previous 90 days' });
  });

  it('never shows a delta for an empty store or a zero prior period', () => {
    expect(describeHomeDelta(0, 0, 'today', { isEmpty: true })).toBeNull();
    expect(describeHomeDelta(500, 0, '30d')).toBeNull();
  });
});

describe('hasTodo', () => {
  it('is false when nothing needs action (section hidden)', () => {
    expect(hasTodo(null)).toBe(false);
    expect(hasTodo({ toShip: 0, toAnswer: 0, lowStock: 0, returns: 0 })).toBe(false);
  });
  it('is true for orders to ship or low stock', () => {
    expect(hasTodo({ toShip: 3, toAnswer: 0, lowStock: 0, returns: 0 })).toBe(true);
    expect(hasTodo({ toShip: 0, toAnswer: 0, lowStock: 2, returns: 0 })).toBe(true);
  });
});

describe('payoutProgress', () => {
  const est = (hoursAhead: number) => ({ kind: 'scheduled', date: new Date(NOW + hoursAhead * 3_600_000).toISOString(), amount: 1000, formatted: '$10.00' });

  it('is the share of the real schedule cycle already elapsed', () => {
    expect(payoutProgress(est(12), { interval: 'daily' }, NOW)).toBeCloseTo(0.5);
    expect(payoutProgress(est(42), { interval: 'weekly' }, NOW)).toBeCloseTo(0.75);
  });
  it('clamps to 0..1', () => {
    expect(payoutProgress(est(-2), { interval: 'daily' }, NOW)).toBe(1);
    expect(payoutProgress(est(24 * 10), { interval: 'weekly' }, NOW)).toBe(0);
  });
  it('is null without a dated payout or a known schedule (bar hidden, never guessed)', () => {
    expect(payoutProgress(null, { interval: 'daily' }, NOW)).toBeNull();
    expect(payoutProgress(est(5), { interval: 'manual' }, NOW)).toBeNull();
    expect(payoutProgress(est(5), null, NOW)).toBeNull();
  });
  it('datedNextPayout only accepts a real dated, non-zero payout', () => {
    expect(datedNextPayout(est(5))?.amount).toBe(1000);
    expect(datedNextPayout({ kind: 'manual', date: null, amount: 500, formatted: '$5.00' })).toBeNull();
    expect(datedNextPayout({ kind: 'none', date: null, amount: 0, formatted: '$0.00' })).toBeNull();
  });
});

describe('mergeDashboardActivity', () => {
  it('merges orders, followers and reviews newest first and caps the list', () => {
    const items = mergeDashboardActivity({
      orders: [{ id: 'o1', createdAt: new Date(NOW - 120_000).toISOString(), customerName: 'Ava' }],
      followers: [{ userId: 'u1', name: 'Noah', followedAt: new Date(NOW - 3 * 3_600_000).toISOString() }],
      reviews: [{ id: 'r1', created_at: new Date(NOW - 60_000).toISOString(), rating: 5, product_name: 'Crew Tee' }],
    });
    expect(items.map((i) => i.kind)).toEqual(['review', 'order', 'follower']);
    expect(items[0].title).toBe('5-star review on Crew Tee');
    expect(items[1]).toMatchObject({ title: 'New order from Ava', route: '/order-detail?id=o1' });
    expect(items[2].title).toBe('Noah followed you');
  });

  it('drops rows without a valid timestamp and respects the limit', () => {
    const orders = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, createdAt: new Date(NOW - i * 1000).toISOString() }));
    expect(mergeDashboardActivity({ orders: [...orders, { id: 'bad', createdAt: 'nope' }] }, 4)).toHaveLength(4);
    expect(mergeDashboardActivity({ orders: [{ id: 'bad', createdAt: 'nope' }] })).toEqual([]);
  });
});

describe('shortRelativeTime', () => {
  it('formats like "2m", "3h"', () => {
    expect(shortRelativeTime(new Date(NOW - 20_000).toISOString(), NOW)).toBe('now');
    expect(shortRelativeTime(new Date(NOW - 2 * 60_000).toISOString(), NOW)).toBe('2m');
    expect(shortRelativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h');
    expect(shortRelativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d');
    expect(shortRelativeTime(new Date(NOW - 14 * 86_400_000).toISOString(), NOW)).toBe('2w');
  });
});
