/**
 * Signed-out web preview payloads for the analytics screens. Each fixture is
 * shaped exactly like its API response so the preview runs through the same
 * mappers in analyticsService as live data. `fresh` (the default preview) is
 * a brand-new store's real zeros; `demo` (&demo=1) is a small populated store.
 * Amounts are integer cents.
 */

export type AnalyticsPreviewMode = 'demo' | 'fresh';
// The five report screens (store, profit, payouts, marketing, production) read
// /api/analytics/reports/* and /api/finance/balance, which the shared preview
// answers in lib/previewApiData.ts; only Sales and Products route through here.
export type AnalyticsPreviewKey = 'revenue' | 'products';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const DEMO_DAILY_CENTS = [8400, 12600, 0, 9800, 15400, 6200, 11800, 14200, 7600, 18900, 10400, 13300, 9100, 16700];

const FRESH: Record<AnalyticsPreviewKey, unknown> = {
  revenue: { totalCents: 0, orderCount: 0, daily: [], breakdown: [] },
  products: [],
};

function demo(key: AnalyticsPreviewKey): unknown {
  switch (key) {
    case 'revenue':
      return {
        totalCents: 174400,
        orderCount: 31,
        daily: DEMO_DAILY_CENTS.map((cents, i) => ({
          day: isoDaysAgo(DEMO_DAILY_CENTS.length - 1 - i), total_cents: cents, order_count: Math.round(cents / 5600),
        })),
        breakdown: [
          { productId: 'demo-tee', label: 'Heavyweight Box Tee', units: 24, revenueCents: 96000, orders: 19, sharePct: 55.0 },
          { productId: 'demo-hoodie', label: 'Garment-Dyed Hoodie', units: 6, revenueCents: 54000, orders: 6, sharePct: 31.0 },
          { productId: 'demo-cap', label: 'Washed Logo Cap', units: 8, revenueCents: 24400, orders: 7, sharePct: 14.0 },
        ],
      };
    case 'products':
      return [
        { productId: 'demo-tee', name: 'Heavyweight Box Tee', imageUrl: null, revenueCents: 96000, unitsSold: 24, orderCount: 19, inventoryStatus: 'in_stock' },
        { productId: 'demo-hoodie', name: 'Garment-Dyed Hoodie', imageUrl: null, revenueCents: 54000, unitsSold: 6, orderCount: 6, inventoryStatus: 'low' },
        { productId: 'demo-cap', name: 'Washed Logo Cap', imageUrl: null, revenueCents: 24400, unitsSold: 8, orderCount: 7, inventoryStatus: 'out_of_stock' },
      ];
  }
}

export function analyticsPreviewPayload(key: AnalyticsPreviewKey, mode: AnalyticsPreviewMode): unknown {
  return mode === 'demo' ? demo(key) : FRESH[key];
}
