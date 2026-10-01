/**
 * Analytics data backed by the API. Endpoints that do not exist yet reject so
 * callers can distinguish unavailable analytics from an empty result.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import { formatCents } from '@/lib/money';
import { getContentApi, type InsightRange } from './sellerInsightsService';
import {
  AnalyticsOverview, SalesAnalytics, ProductAnalytics, CustomerAnalytics,
  ContentAnalytics, StoreAnalytics, MarketingAnalytics, InventoryAnalytics,
  ProductionAnalytics, ProfitAnalytics, PayoutAnalytics, AttributionRecord,
  AnalyticsInsight, AnalyticsExport, AnalyticsFilterState, AnalyticsMetric,
  ExportSection, DATE_RANGE_OPTIONS, COMPARISON_OPTIONS,
} from './analyticsTypes';

/** Set by initAnalyticsService() after sign-in. Falls back to 'anon' so the
 *  service is safe to call before the user ID is available. */
let _analyticsUserId = 'anon';

/** Call once after Clerk resolves the current user ID (and again on sign-out
 *  with null, or when the signed-in user changes) so a different account
 *  never inherits the previous account's saved date-range filter. */
export function initAnalyticsService(userId: string | null): void {
  _analyticsUserId = userId ?? 'anon';
}

function filterKey(uid = _analyticsUserId): string {
  return `bt:analytics:filter:${uid}:v1`;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Analytics ${field} must be an integer number of cents.`);
  return parsed;
}

function metric(key: string, label: string, value: number, unit: AnalyticsMetric['unit']): AnalyticsMetric {
  const formatted = unit === 'currency' ? formatCents(value)
    : unit === 'percent' ? `${value}%`
    : unit === 'days' ? `${value}d`
    : value.toLocaleString();
  return { key, label, value, formatted, unit };
}

function periodFor(filter?: AnalyticsFilterState): string {
  switch (filter?.dateRange.key) {
    case 'today': return 'today';
    case '7d': return 'last7';
    case '90d': return 'last90';
    case 'this_month': return 'thisMonth';
    case 'last_month': return 'lastMonth';
    default: return 'last30';
  }
}

export async function getFilterState(): Promise<AnalyticsFilterState> {
  try {
    const raw = await AsyncStorage.getItem(filterKey());
    if (raw) return JSON.parse(raw) as AnalyticsFilterState;
  } catch { /* a local preference must not block analytics */ }
  return { dateRange: DATE_RANGE_OPTIONS[3], comparison: COMPARISON_OPTIONS[0], groupBy: 'daily' };
}

export async function saveFilterState(state: AnalyticsFilterState): Promise<void> {
  await AsyncStorage.setItem(filterKey(), JSON.stringify(state));
}

export async function getOverview(filter?: AnalyticsFilterState): Promise<AnalyticsOverview> {
  const data = await serviceRequest<any>('/api/analytics/dashboard', {}, false);
  const revenueCents = cents(data?.revenue?.totalCents ?? 0, 'revenue total');
  const orders = number(data?.orders?.total);
  const visitors = number(data?.storefrontVisits);
  const customers = number(data?.customers?.total);
  const heldCents = cents(data?.payouts?.preOrderHeldCents ?? 0, 'pre-order payout total');
  const availableCents = cents(data?.payouts?.preMadeAvailableCents ?? 0, 'pre-made payout total');
  return {
    dateRange: filter?.dateRange ?? DATE_RANGE_OPTIONS[3],
    comparison: filter?.comparison ?? COMPARISON_OPTIONS[0],
    lastUpdated: new Date().toISOString(),
    grossRevenue: metric('gross_revenue', 'Gross Revenue', revenueCents, 'currency'),
    orders: metric('orders', 'Orders', orders, 'number'),
    storeVisitors: metric('visitors', 'Store Visitors', visitors, 'number'),
    pendingPayouts: metric('pre_order_held', 'Pre-order Funds Held', heldCents, 'currency'),
    // The dashboard returns these two distinct payout fields; retain both
    // without combining them into a fabricated aggregate.
    netRevenue: metric('pre_made_available', 'Pre-made Funds Processing', availableCents, 'currency'),
    returningCustomerRate: metric('customers', 'Customers', customers, 'number'),
    revenueChart: [], ordersChart: [], visitorsChart: [], insights: [],
  } as unknown as AnalyticsOverview;
}

export async function getSalesAnalytics(filter?: AnalyticsFilterState): Promise<SalesAnalytics> {
  const data = await serviceRequest<any>(`/api/analytics/revenue?period=${periodFor(filter)}`, {}, false);
  const daily = Array.isArray(data?.daily) ? data.daily : [];
  const salesChart = daily.map((row: any) => ({
    date: typeof row.day === 'string' ? row.day.slice(0, 10) : '',
    value: cents(row.total_cents ?? 0, 'daily revenue'),
  }));
  return {
    grossSales: metric('gross_sales', 'Gross Sales', cents(data?.totalCents ?? 0, 'sales total'), 'currency'),
    ordersChart: [], unitsChart: [], aovChart: [], refundsChart: [],
    salesChart, breakdownBy: 'product', breakdown: [],
    // orderCount is an API value, exposed through the existing orders chart is
    // not possible because the endpoint has no daily order series.
    orders: metric('orders', 'Orders', number(data?.orderCount), 'number'),
  } as unknown as SalesAnalytics;
}

export async function getProductAnalytics(_filter?: AnalyticsFilterState): Promise<ProductAnalytics> {
  const response = await serviceRequest<any>('/api/analytics/products', {}, false);
  const rows = Array.isArray(response) ? response : [];
  const mapped = rows.map((row: any) => ({
    productId: String(row.productId ?? ''),
    name: String(row.name ?? ''),
    revenueCents: cents(row.revenueCents ?? 0, 'product revenue'),
    unitsSold: number(row.unitsSold),
    inventoryStatus: row.inventoryStatus,
  }));
  return { topByRevenue: mapped, topByUnits: [...mapped].sort((a, b) => b.unitsSold - a.unitsSold) } as ProductAnalytics;
}

export async function getCustomerAnalytics(_filter?: AnalyticsFilterState): Promise<CustomerAnalytics> {
  const data = await serviceRequest<any>('/api/analytics/customers?limit=10', {}, false);
  const stats = data?.stats ?? {};
  return {
    totalCustomers: metric('total_customers', 'Total Customers', number(stats.totalCustomers), 'number'),
    returningCustomers: metric('repeat_customers', 'Returning Customers', number(stats.repeatCustomers), 'number'),
    repeatRate: metric('repeat_rate', 'Repeat Rate', number(stats.repeatRate), 'percent'),
    purchaseFrequency: metric('avg_orders_per_customer', 'Avg. Orders per Customer', number(stats.avgOrdersPerCustomer), 'number'),
    cohorts: [], topLocations: [], newVsReturningChart: [],
  } as unknown as CustomerAnalytics;
}

function unavailable(name: string): never {
  throw new Error(`${name} analytics are not available yet.`);
}

export async function getContentAnalytics(filter?: AnalyticsFilterState): Promise<ContentAnalytics> {
  const key = filter?.dateRange.key;
  const range: InsightRange = key === '7d' ? '7d' : key === '90d' ? '90d' : '30d';
  const { totals: t, posts } = await getContentApi(range);
  const count = (k: string, label: string, v: number) => metric(k, label, v, 'number');
  const rows = posts.map(p => ({
    postId: p.postId, type: p.type, thumbnailUrl: p.thumbnailUrl ?? undefined, caption: p.caption || 'Untitled post',
    views: p.views, likes: p.likes, comments: p.comments, saves: p.saves, shares: p.shares,
    productClicks: p.productClicks,
    // The screen renders revenue in whole dollars.
    revenue: Math.round(p.revenueCents / 100),
    // Completion needs media duration, which is not recorded; there is no
    // honest value to show, so it is reported as 0 here and flagged in the PR.
    completionRate: p.completionRate ?? 0,
    publishedAt: p.publishedAt,
  }));
  const withMetric = (k: string, label: string, formatted: string, value: number): AnalyticsMetric =>
    ({ key: k, label, value, formatted, unit: 'number' });
  return {
    views: count('views', 'Views', t.views),
    uniqueViewers: count('unique_viewers', 'Unique Viewers', t.uniqueViewers),
    likes: count('likes', 'Likes', t.likes),
    comments: count('comments', 'Comments', t.comments),
    saves: count('saves', 'Saves', t.saves),
    shares: count('shares', 'Shares', t.shares),
    profileVisits: count('profile_visits', 'Profile Visits', t.profileVisits),
    productClicks: count('product_clicks', 'Product Clicks', t.productClicks),
    addToCarts: count('add_to_carts', 'Add to Bag', t.addToCarts),
    purchases: count('purchases', 'Purchases', t.purchases),
    revenueAttributed: metric('revenue_attributed', 'Attributed Revenue', cents(t.revenueCents, 'attributed revenue'), 'currency'),
    avgWatchTime: t.avgWatchSeconds === null
      ? withMetric('avg_watch_time', 'Avg. Watch Time', '\u2014', 0)
      : withMetric('avg_watch_time', 'Avg. Watch Time', t.avgWatchSeconds.toFixed(1), t.avgWatchSeconds),
    completionRate: t.completionRate === null
      ? withMetric('completion_rate', 'Completion', '\u2014', 0)
      : metric('completion_rate', 'Completion', t.completionRate, 'percent'),
    followerGrowth: count('follower_growth', 'New Followers', t.followerGrowth),
    topVideos: rows.filter(r => r.type === 'video').slice(0, 10),
    topSlideshows: rows.filter(r => r.type === 'slideshow').slice(0, 10),
    highestRevenuePosts: rows.filter(r => r.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    retention: [],
  };
}
export async function getStoreAnalytics(_filter?: AnalyticsFilterState): Promise<StoreAnalytics> { return unavailable('Store'); }
export async function getMarketingAnalytics(_filter?: AnalyticsFilterState): Promise<MarketingAnalytics> { return unavailable('Marketing'); }
export async function getInventoryAnalytics(_filter?: AnalyticsFilterState): Promise<InventoryAnalytics> { return unavailable('Inventory'); }
export async function getProductionAnalytics(_filter?: AnalyticsFilterState): Promise<ProductionAnalytics> { return unavailable('Production'); }
export async function getProfitAnalytics(_filter?: AnalyticsFilterState): Promise<ProfitAnalytics> { return unavailable('Profit'); }
export async function getPayoutAnalytics(): Promise<PayoutAnalytics> { return unavailable('Payout'); }
export async function getAttribution(): Promise<AttributionRecord[]> { return unavailable('Attribution'); }

export async function getInsights(): Promise<AnalyticsInsight[]> { return []; }
export async function dismissInsight(_id: string): Promise<void> {}
export async function completeInsight(_id: string): Promise<void> {}
export async function exportAnalytics(_section: ExportSection, _dateRange: AnalyticsFilterState['dateRange']): Promise<AnalyticsExport> {
  return unavailable('Analytics export');
}