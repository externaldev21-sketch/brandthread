/**
 * analyticsService → /api/seller/analytics/* and the Sales/Product mappings.
 * The five getters used to reject ("not available yet"); they now map the
 * real endpoints, keep integer cents, and in the signed-out web preview map
 * the fixtures in analyticsPreviewFixtures through the same code.
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
import {
  getMarketingAnalytics, getPayoutAnalytics, getProductAnalytics, getProductionAnalytics,
  getProfitAnalytics, getSalesAnalytics, getStoreAnalytics,
} from './analyticsService';
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
  it('marketing calls the seller endpoint with the period and formats cents', async () => {
    request.mockResolvedValue({
      revenue: { marketingCents: 15000, emailCents: 5000, discountCents: 10000 },
      campaigns: [{ campaignId: 'e1', name: 'Drop', type: 'email', recipients: 2, delivered: 2, opens: 1, clicks: 0, sentAt: '2026-10-01' }],
      influencers: [],
      referral: {},
    });
    const data = await getMarketingAnalytics(filter('7d'));
    expect(request).toHaveBeenCalledWith('/api/seller/analytics/marketing?period=last7', {}, false);
    expect(data.marketingRevenue).toMatchObject({ value: 15000, formatted: '$150.00', unit: 'currency' });
    expect(data.smsRevenue.value).toBe(0);
    expect(data.campaigns[0]).toMatchObject({ campaignId: 'e1', type: 'email', recipients: 2, opens: 1, revenueCents: 0 });
    expect(data.referral.revenueCents).toBe(0);
  });

  it('production maps manufacturer spend in cents', async () => {
    request.mockResolvedValue({
      activeJobs: 1, unitsInProduction: 100, productionValueCents: 150000, avgLeadTimeDays: 0, avgSampleTimeDays: 10,
      onTimeCompletionRate: 100, avgUnitCostCents: 1510,
      manufacturers: [{ manufacturerId: 'm1', name: 'Knit', productsProduced: 2, totalUnits: 102, totalSpendCents: 154000, avgUnitCostCents: 1510 }],
    });
    const data = await getProductionAnalytics();
    expect(request).toHaveBeenCalledWith('/api/seller/analytics/production', {}, false);
    expect(data.productionValue.formatted).toBe('$1,500.00');
    expect(data.avgSampleTimeDays.formatted).toBe('10d');
    expect(data.avgManufacturerResponse.formatted).toBe('—');
    expect(data.manufacturers[0]).toMatchObject({ totalSpend: 154000, avgUnitCost: 1510 });
  });

  it('profit maps line items and the daily chart', async () => {
    request.mockResolvedValue({
      grossCents: 16000, netRevenueCents: 14200, estimatedProfitCents: 13400, profitMarginPct: 89.3,
      lineItems: [{ label: 'Gross Sales', amount: 16000, isEstimate: false, isDeduction: false }],
      daily: [{ date: '2026-10-20', netCents: 13400, marginPct: 89.3 }],
    });
    const data = await getProfitAnalytics(filter('90d'));
    expect(request).toHaveBeenCalledWith('/api/seller/analytics/profit?period=last90', {}, false);
    expect(data.estimatedProfit.formatted).toBe('$134.00');
    expect(data.profitMargin.formatted).toBe('89.3%');
    expect(data.lineItems).toEqual([{ label: 'Gross Sales', amount: 16000, isEstimate: false, isDeduction: false }]);
    expect(data.profitChart).toEqual([{ date: '2026-10-20', value: 13400 }]);
  });

  it('payouts maps balances, next payout and history; no next payout reads as not scheduled', async () => {
    request.mockResolvedValueOnce({
      availableCents: 5000, pendingCents: 800, heldCents: 3000, totalPaidOutCents: 8800,
      nextPayout: { amountCents: 5000, arrivalDate: '2026-10-26T12:00:00.000Z' },
      history: [{ id: 'po_1', amountCents: 8800, status: 'paid', arrivalDate: '2026-10-10T00:00:00.000Z' }],
    });
    const data = await getPayoutAnalytics();
    expect(request).toHaveBeenCalledWith('/api/seller/analytics/payouts?period=last30', {}, false);
    expect(data.availableBalance.formatted).toBe('$50.00');
    expect(data.nextPayoutAmount.value).toBe(5000);
    expect(data.nextPayoutDate).toMatch(/Oct 2[67]/);
    expect(data.history).toEqual([{ id: 'po_1', amountCents: 8800, status: 'paid', arrivalDate: '2026-10-10T00:00:00.000Z' }]);

    request.mockResolvedValueOnce({ nextPayout: null });
    expect((await getPayoutAnalytics()).nextPayoutDate).toBe('Not scheduled');
  });

  it('store maps the funnel and turns traffic sources into the section list', async () => {
    request.mockResolvedValue({
      visitors: 3, uniqueVisitors: 2, sessions: 4, productPageViews: 2, mobileTrafficPct: 50,
      funnel: [{ label: 'Store visits', count: 4, conversionPct: 100, dropOffPct: 50 }],
      trafficSources: [{ source: 'feed', label: 'Discover feed', visits: 3, productViews: 1, sharePct: 75 }],
      daily: [{ date: '2026-10-01', visitors: 2 }],
    });
    const data = await getStoreAnalytics(filter('today'));
    expect(request).toHaveBeenCalledWith('/api/seller/analytics/store?period=today', {}, false);
    expect(data.mobileTrafficPct.formatted).toBe('50%');
    expect(data.avgSessionDuration.formatted).toBe('—');
    expect(data.funnel).toEqual([{ label: 'Store visits', count: 4, conversionPct: 100, dropOffPct: 50 }]);
    expect(data.sections).toEqual([{ sectionKey: 'feed', label: 'Discover feed', views: 3, clicks: 1, ctr: 33.3, purchasesInfluenced: 0 }]);
    expect(data.visitorsChart).toEqual([{ date: '2026-10-01', value: 2 }]);
  });

  it('sales maps the per-product breakdown and the daily orders chart', async () => {
    request.mockResolvedValue({
      totalCents: 16000, orderCount: 2,
      daily: [{ day: '2026-10-20T00:00:00.000Z', total_cents: 16000, order_count: 2 }],
      breakdown: [{ productId: 'p1', label: 'Tee', units: 3, revenueCents: 15000, orders: 2, sharePct: 93.8 }],
    });
    const data = await getSalesAnalytics();
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
    request.mockResolvedValue({ revenue: { marketingCents: 12.5 } });
    await expect(getMarketingAnalytics()).rejects.toThrow(/integer number of cents/);
  });
});

describe('signed-out web preview', () => {
  const getters = [getMarketingAnalytics, getProductionAnalytics, getProfitAnalytics, getPayoutAnalytics, getStoreAnalytics, getSalesAnalytics, getProductAnalytics];

  it('fresh preview resolves every screen to zeros without calling the API', async () => {
    preview.seller = true;
    for (const getter of getters) await expect(getter()).resolves.toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    expect((await getMarketingAnalytics()).marketingRevenue.value).toBe(0);
    expect((await getProductionAnalytics()).manufacturers).toEqual([]);
    expect((await getProfitAnalytics()).estimatedProfit.value).toBe(0);
    expect((await getStoreAnalytics()).visitors.value).toBe(0);
    expect((await getSalesAnalytics()).breakdown).toEqual([]);
  });

  it('demo preview shows populated states', async () => {
    preview.seller = true;
    preview.demo = true;
    expect((await getMarketingAnalytics()).campaigns.length).toBeGreaterThan(0);
    expect((await getProductionAnalytics()).manufacturers.length).toBeGreaterThan(0);
    const profit = await getProfitAnalytics();
    expect(profit.lineItems.at(-1)?.label).toBe('Est. Profit');
    expect(profit.estimatedProfit.value).toBe(profit.lineItems.at(-1)?.amount);
    expect((await getPayoutAnalytics()).availableBalance.value).toBeGreaterThan(0);
    expect((await getStoreAnalytics()).sections.length).toBe(4);
    expect((await getSalesAnalytics()).breakdown.length).toBeGreaterThan(0);
    expect(request).not.toHaveBeenCalled();
  });
});
