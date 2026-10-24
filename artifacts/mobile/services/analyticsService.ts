/**
 * Analytics data backed by the API. Endpoints that do not exist yet reject so
 * callers can distinguish unavailable analytics from an empty result. Every
 * currency value from the API is integer cents.
 *
 * The signed-out web preview never calls the API: it maps the fixtures in
 * analyticsPreviewFixtures (fresh = zeros, &demo=1 = a populated store)
 * through the same mappers as live data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import { formatCents } from '@/lib/money';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { analyticsPreviewPayload, type AnalyticsPreviewKey } from './analyticsPreviewFixtures';
import {
  AnalyticsOverview, SalesAnalytics, ProductAnalytics, CustomerAnalytics,
  ContentAnalytics, StoreAnalytics, MarketingAnalytics, InventoryAnalytics,
  ProductionAnalytics, ProfitAnalytics, PayoutAnalytics, AttributionRecord,
  AnalyticsInsight, AnalyticsExport, AnalyticsFilterState, AnalyticsMetric,
  ExportSection, DATE_RANGE_OPTIONS, COMPARISON_OPTIONS, PushNotificationResults,
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

/** Live API payload, or the preview fixture of the same shape. */
async function analyticsRequest<T>(key: AnalyticsPreviewKey, path: string): Promise<T> {
  if (isSellerDevPreview()) return analyticsPreviewPayload(key, isPreviewDemoMode() ? 'demo' : 'fresh') as T;
  return serviceRequest<T>(path, {}, false);
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

/** A metric the backend does not measure yet: shown as a dash, not a fake 0. */
function untracked(key: string, label: string, unit: AnalyticsMetric['unit']): AnalyticsMetric {
  return { key, label, value: 0, formatted: '—', unit };
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
    case 'this_week': return 'thisWeek';
    case 'this_month': return 'thisMonth';
    case 'last_month': return 'lastMonth';
    case 'this_year': return 'thisYear';
    case 'all': return 'all';
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
  // Seller-local "today"/"this week", like the Home dashboard (/home).
  const data = await serviceRequest<any>(`/api/analytics/dashboard?tz=${-new Date().getTimezoneOffset()}`, {}, false);
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
  const data = await analyticsRequest<any>('revenue', `/api/analytics/revenue?period=${periodFor(filter)}&tz=${-new Date().getTimezoneOffset()}`);
  const daily = list(data?.daily);
  const dateOf = (row: any) => typeof row.day === 'string' ? row.day.slice(0, 10) : '';
  const salesChart = daily.map((row: any) => ({
    date: dateOf(row),
    value: cents(row.total_cents ?? 0, 'daily revenue'),
  }));
  const ordersChart = daily.map((row: any) => ({ date: dateOf(row), value: number(row.order_count) }));
  const breakdown = list(data?.breakdown).map((row: any) => ({
    key: String(row.productId ?? row.label ?? ''),
    label: String(row.label ?? ''),
    revenue: cents(row.revenueCents ?? 0, 'product sales'),
    orders: number(row.orders),
    units: number(row.units),
    sharePct: number(row.sharePct),
  }));
  return {
    grossSales: metric('gross_sales', 'Gross Sales', cents(data?.totalCents ?? 0, 'sales total'), 'currency'),
    ordersChart, unitsChart: [], aovChart: [], refundsChart: [],
    salesChart, breakdownBy: 'product', breakdown,
    orders: metric('orders', 'Orders', number(data?.orderCount), 'number'),
  } as unknown as SalesAnalytics;
}

export async function getProductAnalytics(_filter?: AnalyticsFilterState): Promise<ProductAnalytics> {
  const response = await analyticsRequest<any>('products', '/api/analytics/products');
  const rows = list(response);
  const mapped = rows.map((row: any) => ({
    productId: String(row.productId ?? ''),
    name: String(row.name ?? ''),
    imageUrl: typeof row.imageUrl === 'string' && row.imageUrl.length > 0 ? row.imageUrl : undefined,
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

/** Query string for GET /api/analytics/reports/* (server accepts the same range keys). */
export function reportRangeQuery(filter?: AnalyticsFilterState): string {
  return `range=${encodeURIComponent(filter?.dateRange.key ?? '30d')}`;
}

/** A metric from a nullable server number; undefined (hidden) when the server has no value. */
function optionalMetric(key: string, label: string, value: unknown, unit: AnalyticsMetric['unit']): AnalyticsMetric | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return metric(key, label, unit === 'currency' ? cents(parsed, label) : parsed, unit);
}

export function mapStoreReport(data: any): StoreAnalytics {
  return {
    visitors: metric('visitors', 'Visitors', number(data?.visitors), 'number'),
    uniqueVisitors: metric('unique_visitors', 'Unique Visitors', number(data?.uniqueVisitors), 'number'),
    sessions: metric('store_visits', 'Store Visits', number(data?.sessions), 'number'),
    productPageViews: metric('product_views', 'Product Views', number(data?.productPageViews), 'number'),
    returningVisitors: metric('returning', 'Returning Visitors', number(data?.returningVisitors), 'number'),
    mobileTrafficPct: optionalMetric('mobile', 'Mobile Traffic', data?.mobileTrafficPct, 'percent'),
    addToCartRate: optionalMetric('atc', 'Add-to-bag Rate', data?.addToCartRate, 'percent'),
    checkoutStartRate: optionalMetric('checkout', 'Checkout Rate', data?.checkoutStartRate, 'percent'),
    purchaseConversion: optionalMetric('purchase', 'Purchase Conversion', data?.purchaseConversion, 'percent'),
    avgSessionDuration: undefined,
    funnel: Array.isArray(data?.funnel) ? data.funnel.map((f: any) => ({
      label: String(f.label ?? ''), count: number(f.count), conversionPct: number(f.conversionPct), dropOffPct: number(f.dropOffPct),
    })) : [],
    sections: [],
    visitorsChart: Array.isArray(data?.visitorsChart)
      ? data.visitorsChart.map((p: any) => ({ date: String(p.date ?? ''), value: number(p.value) }))
      : [],
  } as StoreAnalytics;
}

export function mapProfitReport(data: any): ProfitAnalytics {
  return {
    grossRevenue: metric('gross', 'Gross Sales', cents(data?.grossRevenueCents ?? 0, 'gross sales'), 'currency'),
    netRevenue: metric('net', 'Net Revenue', cents(data?.netRevenueCents ?? 0, 'net revenue'), 'currency'),
    estimatedProfit: metric('profit', 'Est. Profit', cents(data?.estimatedProfitCents ?? 0, 'profit'), 'currency'),
    profitMargin: optionalMetric('margin', 'Margin', data?.profitMarginPct, 'percent'),
    lineItems: Array.isArray(data?.lineItems) ? data.lineItems.map((l: any) => ({
      label: String(l.label ?? ''),
      amountCents: Math.abs(cents(l.amountCents ?? 0, 'profit line')),
      isEstimate: !!l.isEstimate,
      isDeduction: !!l.isDeduction,
    })) : [],
    netRevenueChart: Array.isArray(data?.netRevenueChart)
      ? data.netRevenueChart.map((p: any) => ({ date: String(p.date ?? ''), value: number(p.value) }))
      : [],
  };
}

export function mapMarketingReport(data: any): MarketingAnalytics {
  return {
    marketingRevenue: metric('marketing_revenue', 'Marketing Revenue', cents(data?.marketingRevenueCents ?? 0, 'marketing revenue'), 'currency'),
    channels: Array.isArray(data?.channels) ? data.channels.map((c: any) => ({
      key: String(c.key ?? ''), label: String(c.label ?? ''), revenueCents: cents(c.revenueCents ?? 0, 'channel revenue'),
    })) : [],
    campaigns: Array.isArray(data?.campaigns) ? data.campaigns.map((c: any) => ({
      campaignId: String(c.campaignId ?? ''),
      name: String(c.name ?? ''),
      type: c.type === 'push' ? 'push' : 'email',
      recipients: number(c.recipients),
      delivered: number(c.delivered),
      opens: c.opens === null || c.opens === undefined ? null : number(c.opens),
      clicks: c.clicks === null || c.clicks === undefined ? null : number(c.clicks),
      sentAt: typeof c.sentAt === 'string' ? c.sentAt : null,
    })) : [],
    influencers: Array.isArray(data?.influencers) ? data.influencers.map((i: any) => ({
      influencerId: String(i.influencerId ?? ''),
      name: String(i.name ?? ''),
      clicks: number(i.clicks),
      orders: number(i.orders),
      revenueCents: cents(i.revenueCents ?? 0, 'creator revenue'),
      commissionCents: cents(i.commissionCents ?? 0, 'creator commission'),
      returnOnCost: i.returnOnCost === null || i.returnOnCost === undefined ? null : number(i.returnOnCost),
    })) : [],
  };
}

export function mapProductionReport(data: any): ProductionAnalytics {
  return {
    activeJobs: metric('active', 'Active Jobs', number(data?.activeJobs), 'number'),
    unitsInProduction: metric('units', 'Units in Production', number(data?.unitsInProduction), 'number'),
    productionValue: metric('value', 'In-production Value', cents(data?.productionValueCents ?? 0, 'production value'), 'currency'),
    totalSpend: metric('spend', 'Production Spend', cents(data?.spendCents ?? 0, 'production spend'), 'currency'),
    avgLeadTimeDays: optionalMetric('lead', 'Avg. Bulk Lead Time', data?.avgLeadTimeDays, 'days'),
    avgSampleTimeDays: optionalMetric('sample', 'Avg. Sample Time', data?.avgSampleTimeDays, 'days'),
    avgUnitCost: optionalMetric('unit_cost', 'Avg. Unit Cost', data?.avgUnitCostCents, 'currency'),
    manufacturers: Array.isArray(data?.manufacturers) ? data.manufacturers.map((m: any) => ({
      manufacturerId: String(m.manufacturerId ?? ''),
      name: String(m.name ?? ''),
      productsProduced: number(m.productsProduced),
      totalUnits: number(m.totalUnits),
      totalSpendCents: cents(m.totalSpendCents ?? 0, 'manufacturer spend'),
      avgUnitCostCents: m.avgUnitCostCents === null || m.avgUnitCostCents === undefined ? null : number(m.avgUnitCostCents),
      avgLeadTimeDays: m.avgLeadTimeDays === null || m.avgLeadTimeDays === undefined ? null : number(m.avgLeadTimeDays),
    })) : [],
  };
}

export async function getContentAnalytics(_filter?: AnalyticsFilterState): Promise<ContentAnalytics> { return unavailable('Content'); }
export async function getStoreAnalytics(filter?: AnalyticsFilterState): Promise<StoreAnalytics> {
  return mapStoreReport(await serviceRequest<any>(`/api/analytics/reports/store?${reportRangeQuery(filter)}`, {}, false));
}
export async function getMarketingAnalytics(filter?: AnalyticsFilterState): Promise<MarketingAnalytics> {
  return mapMarketingReport(await serviceRequest<any>(`/api/analytics/reports/marketing?${reportRangeQuery(filter)}`, {}, false));
}
/** All-time push delivery + engagement totals for this store (aggregate only). */
export async function getPushNotificationResults(): Promise<PushNotificationResults> {
  const data = await serviceRequest<any>('/api/analytics/notifications', {}, false);
  return {
    queued: number(data?.queued),
    sent: number(data?.sent),
    providerErrors: number(data?.providerErrors),
    received: number(data?.events?.receipt ?? data?.receipt),
    opened: number(data?.events?.open ?? data?.open),
    tapped: number(data?.events?.tap ?? data?.tap),
  };
}
export async function getInventoryAnalytics(_filter?: AnalyticsFilterState): Promise<InventoryAnalytics> { return unavailable('Inventory'); }
export async function getProductionAnalytics(filter?: AnalyticsFilterState): Promise<ProductionAnalytics> {
  return mapProductionReport(await serviceRequest<any>(`/api/analytics/reports/production?${reportRangeQuery(filter)}`, {}, false));
}
export async function getProfitAnalytics(filter?: AnalyticsFilterState): Promise<ProfitAnalytics> {
  return mapProfitReport(await serviceRequest<any>(`/api/analytics/reports/profit?${reportRangeQuery(filter)}`, {}, false));
}
/** Live Stripe balance (GET /api/finance/balance). */
export async function getPayoutAnalytics(): Promise<PayoutAnalytics> {
  const data = await serviceRequest<any>('/api/finance/balance', {}, false);
  const next = data?.nextPayout;
  return {
    availableBalance: metric('available', 'Available Balance', cents(data?.available?.amount ?? 0, 'available balance'), 'currency'),
    pendingBalance: metric('pending', 'Pending Balance', cents(data?.pending?.amount ?? 0, 'pending balance'), 'currency'),
    nextPayoutAmount: next ? metric('next_payout', 'Next Payout', cents(next.amount ?? 0, 'next payout'), 'currency') : undefined,
    nextPayoutDate: next?.arrivalDate ? new Date(next.arrivalDate).toLocaleDateString() : undefined,
  };
}
export async function getAttribution(): Promise<AttributionRecord[]> { return unavailable('Attribution'); }

export async function getInsights(): Promise<AnalyticsInsight[]> { return []; }
export async function dismissInsight(_id: string): Promise<void> {}
export async function completeInsight(_id: string): Promise<void> {}
export async function exportAnalytics(_section: ExportSection, _dateRange: AnalyticsFilterState['dateRange']): Promise<AnalyticsExport> {
  return unavailable('Analytics export');
}