/**
 * analyticsService Sales / Product mappings: the per-product sales breakdown,
 * the daily orders series and product thumbnails, plus the signed-out web
 * preview fixtures they run through. (The five report getters map
 * /api/analytics/reports/* — see tests/seller-analytics-ai-settings-wiring.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = vi.hoisted(() => ({ seller: false, demo: false }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => preview.seller,
  isPreviewDemoMode: () => preview.demo,
}));

import { serviceRequest } from '@/lib/serviceConfig';
import { getProductAnalytics, getSalesAnalytics } from './analyticsService';
import { DATE_RANGE_OPTIONS, COMPARISON_OPTIONS, type AnalyticsFilterState } from './analyticsTypes';

const request = vi.mocked(serviceRequest);
const filter = (key: string): AnalyticsFilterState => ({
  dateRange: DATE_RANGE_OPTIONS.find((o) => o.key === key) ?? DATE_RANGE_OPTIONS[3],
  comparison: COMPARISON_OPTIONS[0],
  groupBy: 'daily',
});

beforeEach(() => {
  request.mockReset();
  preview.seller = false;
  preview.demo = false;
});

describe('live API', () => {
  it('sales maps the per-product breakdown and the daily orders chart', async () => {
    request.mockResolvedValue({
      totalCents: 16000, orderCount: 2,
      daily: [{ day: '2026-10-20', total_cents: 16000, order_count: 2 }],
      breakdown: [{ productId: 'p1', label: 'Tee', units: 3, revenueCents: 15000, orders: 2, sharePct: 93.8 }],
    });
    const data = await getSalesAnalytics(filter('7d'));
    expect(request.mock.calls[0][0]).toMatch(/^\/api\/analytics\/revenue\?period=last7&tz=-?\d+$/);
    expect(data.breakdown).toEqual([{ key: 'p1', label: 'Tee', revenue: 15000, orders: 2, units: 3, sharePct: 93.8 }]);
    expect(data.ordersChart).toEqual([{ date: '2026-10-20', value: 2 }]);
  });

  it('product rows carry the product image', async () => {
    request.mockResolvedValue([
      { productId: 'p1', name: 'Tee', imageUrl: 'https://img.test/tee.jpg', revenueCents: 100, unitsSold: 1 },
      { productId: 'p2', name: 'Cap', imageUrl: null, revenueCents: 50, unitsSold: 2 },
    ]);
    const data = await getProductAnalytics();
    expect(data.topByRevenue.map((r) => r.imageUrl)).toEqual(['https://img.test/tee.jpg', undefined]);
  });

  it('rejects non-integer cents instead of guessing units', async () => {
    request.mockResolvedValue({ totalCents: 12.5, daily: [] });
    await expect(getSalesAnalytics()).rejects.toThrow(/integer number of cents/);
  });
});

describe('signed-out web preview', () => {
  it('fresh preview resolves to zeros without calling the API', async () => {
    preview.seller = true;
    expect((await getSalesAnalytics()).breakdown).toEqual([]);
    expect((await getProductAnalytics()).topByRevenue).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('demo preview shows populated states', async () => {
    preview.seller = true;
    preview.demo = true;
    expect((await getSalesAnalytics()).breakdown.length).toBeGreaterThan(0);
    expect((await getProductAnalytics()).topByRevenue.length).toBeGreaterThan(0);
    expect(request).not.toHaveBeenCalled();
  });
});
