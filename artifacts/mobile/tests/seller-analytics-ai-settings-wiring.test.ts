/**
 * Seller dead-end fixes (audit items 23–28, 40, 53, 54):
 *  - More → Customers opens the real customer list; More → Integrations the real list
 *  - every analytics-* report screen is reachable from the Analytics Reports list
 *  - Store / Profit / Marketing / Production read real report endpoints and
 *    never invent a metric the server didn't return
 *  - shop clicks per post and push notification results are surfaced
 *  - Meta reach shows Meta's own estimate or "unavailable", never a formula
 *  - AI Settings persist to the server and are honoured by the app
 *  - Customer privacy is a real, persisted setting
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
  },
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false, isPreviewDemoMode: () => false, isBuyerDevPreview: () => false }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (o: unknown) => o } }));
vi.mock('expo-haptics', () => ({ selectionAsync: () => undefined }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({}) }));
vi.mock('../services/aiBrandMemory', () => ({ getEnabledMemorySummary: async () => ({}) }));
vi.mock('../services/aiAuditLog', () => ({ addAuditEntry: async () => undefined }));
vi.mock('../lib/previewAiBrain', () => ({ getPreviewAiReply: () => '' }));

import { ANALYTICS_REPORTS } from '@/components/analytics/AnalyticsReportsList';
import {
  getStoreAnalytics, getProfitAnalytics, getMarketingAnalytics, getProductionAnalytics,
  getPushNotificationResults, mapStoreReport,
} from '@/services/analyticsService';
import { metricTiles } from '@/lib/analyticsMetricTiles';
import { describeMetaReachEstimate } from '@/services/metaAdsService';
import { confirmationFor, getAISettings, pushAISettings, syncAISettingsFromServer } from '@/services/aiService';
import { DEFAULT_AI_SETTINGS } from '@/services/aiTypes';
import { normalizeCustomerPrivacy } from '@/lib/customerPrivacy';
import { DATE_RANGE_OPTIONS, COMPARISON_OPTIONS } from '@/services/analyticsTypes';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const filter = { dateRange: DATE_RANGE_OPTIONS[2], comparison: COMPARISON_OPTIONS[0], groupBy: 'daily' as const };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

beforeEach(() => {
  request.mockReset();
  for (const k of Object.keys(store)) delete store[k];
});

describe('More menu (items 23, 53)', () => {
  const more = read('app/(tabs)/more.tsx');
  it('Customers opens the real customer list, not the "not configurable" stub', () => {
    expect(more).toMatch(/label: 'Customers'[^\n]*route: '\/customers'/);
    expect(more).not.toMatch(/route: '\/customer-accounts'/);
    expect(read('lib/sellerControlCenter.ts')).toMatch(/id: 'customers'[^\n]*route: '\/customers'/);
    expect(read('app/customers.tsx')).toContain("serviceRequest<SellerCustomer[]>(url)");
  });
  it('Integrations opens the integrations list, not Klaviyo directly', () => {
    expect(more).toMatch(/label: 'Integrations'[^\n]*route: '\/integrations' \}/);
    expect(existsSync(resolve(ROOT, 'app/integrations/index.tsx'))).toBe(true);
  });
});

describe('Analytics reports list (item 25)', () => {
  it('links every analytics report screen and only real routes', () => {
    const hrefs = ANALYTICS_REPORTS.map(r => r.href);
    for (const name of ['profit', 'store', 'customers', 'marketing', 'production']) {
      expect(hrefs).toContain(`/analytics-${name}`);
    }
    // Sales and products already live in the consolidated real-data reports,
    // rather than the retired standalone analytics-sales/products routes.
    expect(hrefs).toContain('/analytics-reports?report=advanced');
    expect(hrefs).toContain('/analytics-reports?report=product-stats');
    for (const href of hrefs) expect(existsSync(resolve(ROOT, `app${href.split('?')[0]}.tsx`))).toBe(true);
  });
});

describe('report services (items 24, 25, 26)', () => {
  it('Store analytics reads the store report and hides metrics the server did not record', async () => {
    request.mockResolvedValueOnce({
      visitors: 10, uniqueVisitors: 8, sessions: 14, productPageViews: 9, returningVisitors: 2,
      mobileTrafficPct: null, addToCartRate: 20, checkoutStartRate: 10, purchaseConversion: 5,
      funnel: [{ label: 'Store visitors', count: 10, conversionPct: 100, dropOffPct: 10 }], visitorsChart: [],
    });
    const store = await getStoreAnalytics(filter);
    expect(request.mock.calls[0][0]).toBe('/api/analytics/reports/store?range=7d');
    expect(store.visitors.value).toBe(10);
    expect(store.mobileTrafficPct).toBeUndefined();
    expect(store.avgSessionDuration).toBeUndefined();
    expect(metricTiles([['m', store.mobileTrafficPct], ['a', store.addToCartRate]]).map(t => t.key)).toEqual(['a']);
  });
  it('Profit, Marketing and Production call their real endpoints (no hard-coded failure)', async () => {
    request.mockResolvedValueOnce({
      grossRevenueCents: 1000, netRevenueCents: 800, estimatedProfitCents: -200, profitMarginPct: -20,
      lineItems: [{ label: 'Refunds', amountCents: 200, isDeduction: true, isEstimate: false }], netRevenueChart: [],
    });
    const profit = await getProfitAnalytics(filter);
    expect(request.mock.calls[0][0]).toBe('/api/analytics/reports/profit?range=7d');
    expect(profit.estimatedProfit.value).toBe(-200);
    expect(profit.lineItems[0].amountCents).toBe(200);

    request.mockResolvedValueOnce({ marketingRevenueCents: 500, channels: [{ key: 'discounts', label: 'Discount codes', revenueCents: 500 }], campaigns: [], influencers: [] });
    const mkt = await getMarketingAnalytics(filter);
    expect(request.mock.calls[1][0]).toBe('/api/analytics/reports/marketing?range=7d');
    expect(mkt.channels[0].revenueCents).toBe(500);

    request.mockResolvedValueOnce({ activeJobs: 1, unitsInProduction: 5, productionValueCents: 100, spendCents: 100, avgLeadTimeDays: null, avgUnitCostCents: 20, manufacturers: [] });
    const prod = await getProductionAnalytics(filter);
    expect(request.mock.calls[2][0]).toBe('/api/analytics/reports/production?range=7d');
    expect(prod.avgLeadTimeDays).toBeUndefined();
    expect(prod.avgUnitCost?.value).toBe(20);
  });
  it('maps the push notification results report', async () => {
    request.mockResolvedValueOnce({ queued: 1, sent: 9, providerErrors: 1, events: { receipt: 8, open: 4, tap: 2 } });
    expect(await getPushNotificationResults()).toEqual({ queued: 1, sent: 9, providerErrors: 1, received: 8, opened: 4, tapped: 2 });
    expect(request.mock.calls[0][0]).toBe('/api/analytics/notifications');
  });
  it('mapStoreReport tolerates an empty body with real zeros', () => {
    const s = mapStoreReport({});
    expect(s.visitors.value).toBe(0);
    expect(s.funnel).toEqual([]);
  });
  it('surfaces shop clicks per post on Content analytics and push results on Marketing', () => {
    expect(read('components/analytics/reports/ContentReport.tsx')).toContain('getPostShopClicks');
    expect(read('services/sellerInsightsService.ts')).toContain("'/api/analytics/post-clicks'");
    expect(read('app/analytics-marketing.tsx')).toContain('getPushNotificationResults');
  });
});

describe('Meta reach estimate (item 28)', () => {
  it('shows Meta\'s number or says it is unavailable — never a fixed range', () => {
    const ok = describeMetaReachEstimate({
      available: true, source: 'meta', dailyReach: 4200, dailySpendCents: 1000,
      audienceSizeLower: 100000, audienceSizeUpper: 200000, currency: 'USD',
    });
    expect(ok.headline).toContain('4,200');
    expect(ok.detail).toContain('100,000–200,000');
    const no = describeMetaReachEstimate({ available: false, reason: 'Connect a Meta ad account.' });
    expect(no.headline).toBe('Reach estimate unavailable');
    expect(no.detail).toBe('Connect a Meta ad account.');
    expect(read('app/meta-ads-setup.tsx')).toContain('api.metaAds.reachEstimate(');
  });
});

describe('AI Settings (item 40)', () => {
  it('loads from and saves to the server', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://api.test');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      settings: { ...DEFAULT_AI_SETTINGS, enabled: false }, updatedAt: '2026-10-17T00:00:00Z',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const s = await syncAISettingsFromServer('test-token');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/v1/ai/settings');
    expect(s?.enabled).toBe(false);
    expect(s?.dataSources.orders).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await pushAISettings({ ...DEFAULT_AI_SETTINGS, confirmSending: false }, 'test-token')).toBe(true);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect((await getAISettings()).confirmSending).toBe(false);
    expect(Object.keys(store).filter(k => k.includes('pending'))).toHaveLength(0);
  });
  it('a failed server save reports false and retains the offline outbox', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://api.test');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')));
    expect(await pushAISettings(DEFAULT_AI_SETTINGS, 'test-token')).toBe(false);
    expect(Object.keys(store).some(k => k.includes('pending'))).toBe(true);
  });
  it('confirmations follow the four toggles', () => {
    const base = { type: 'apply' as const, title: 'Publish the summer drop', description: '', isDestructive: false, requiresConfirmation: false };
    expect(confirmationFor(base, DEFAULT_AI_SETTINGS)?.title).toBe('Publish?');
    expect(confirmationFor(base, { ...DEFAULT_AI_SETTINGS, confirmPublishing: false })).toBeNull();
    const destroy = { ...base, title: 'Delete old drafts', isDestructive: true };
    expect(confirmationFor(destroy, DEFAULT_AI_SETTINGS)?.destructive).toBe(true);
    expect(confirmationFor(destroy, { ...DEFAULT_AI_SETTINGS, confirmDestructiveActions: false })).toBeNull();
    const send = { ...base, title: 'Send a restock email' };
    expect(confirmationFor(send, DEFAULT_AI_SETTINGS)?.title).toBe('Send?');
    expect(confirmationFor(send, { ...DEFAULT_AI_SETTINGS, confirmSending: false })).toBeNull();
    const sensitive = { ...base, title: 'Update price', requiresConfirmation: true };
    expect(confirmationFor(sensitive, DEFAULT_AI_SETTINGS)).not.toBeNull();
    expect(confirmationFor(sensitive, { ...DEFAULT_AI_SETTINGS, confirmSensitiveActions: false })).toBeNull();
  });
  it('assistant entry points honour "Enable AI assistant"', () => {
    expect(read('services/aiService.ts')).toContain('if (!settings.enabled)');
    expect(read('components/AIBrainFAB.tsx')).toContain('if (!aiEnabled) return null;');
  });
});

describe('Customer privacy (item 54)', () => {
  it('is a real persisted setting, not a "Not available yet" stub', () => {
    const src = read('app/customer-privacy.tsx');
    expect(src).not.toContain('Not available yet');
    expect(src).toContain('api.seller.updateSettings({ customerPrivacy: next })');
    expect(normalizeCustomerPrivacy({ maskContactInExports: true }).maskContactInExports).toBe(true);
    expect(normalizeCustomerPrivacy(undefined).maskContactInExports).toBe(false);
  });
});
