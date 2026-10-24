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
  const data = await analyticsRequest<any>('revenue', `/api/analytics/revenue?period=${periodFor(filter)}`);
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

export async function getContentAnalytics(_filter?: AnalyticsFilterState): Promise<ContentAnalytics> { return unavailable('Content'); }

export async function getStoreAnalytics(filter?: AnalyticsFilterState): Promise<StoreAnalytics> {
  const data = await analyticsRequest<any>('store', `/api/seller/analytics/store?period=${periodFor(filter)}`);
  const trafficSources = list(data?.trafficSources).map((row: any) => ({
    source: String(row.source ?? ''),
    label: String(row.label ?? row.source ?? ''),
    visits: number(row.visits),
    productViews: number(row.productViews),
    sharePct: number(row.sharePct),
  }));
  return {
    visitors: metric('visitors', 'Visitors', number(data?.visitors), 'number'),
    uniqueVisitors: metric('unique_visitors', 'Unique Visitors', number(data?.uniqueVisitors), 'number'),
    sessions: metric('sessions', 'Store Visits', number(data?.sessions), 'number'),
    productPageViews: metric('product_views', 'Product Views', number(data?.productPageViews), 'number'),
    addToCartRate: metric('add_to_cart_rate', 'Add-to-Cart Rate', number(data?.addToCartRate), 'percent'),
    checkoutStartRate: metric('checkout_start_rate', 'Checkout Start Rate', number(data?.checkoutStartRate), 'percent'),
    purchaseConversion: metric('purchase_conversion', 'Purchase Conversion', number(data?.purchaseConversion), 'percent'),
    avgSessionDuration: untracked('avg_session_duration', 'Avg. Session', 'number'),
    returningVisitors: metric('returning_visitors', 'Returning Visitors', number(data?.returningVisitors), 'number'),
    mobileTrafficPct: metric('mobile_traffic', 'Mobile Traffic', number(data?.mobileTrafficPct), 'percent'),
    funnel: list(data?.funnel).map((step: any) => ({
      label: String(step.label ?? ''),
      count: number(step.count),
      conversionPct: number(step.conversionPct),
      dropOffPct: number(step.dropOffPct),
    })),
    // Store sections are not tracked; the per-source visit split is the
    // breakdown that exists (the Dashboard's Traffic sources "See all").
    sections: trafficSources.map((row) => ({
      sectionKey: row.source,
      label: row.label,
      views: row.visits,
      clicks: row.productViews,
      ctr: row.visits > 0 ? Math.round((row.productViews / row.visits) * 1000) / 10 : 0,
      purchasesInfluenced: 0,
    })),
    trafficSources,
    visitorsChart: list(data?.daily).map((row: any) => ({ date: String(row.date ?? ''), value: number(row.visitors) })),
  };
}

export async function getMarketingAnalytics(filter?: AnalyticsFilterState): Promise<MarketingAnalytics> {
  const data = await analyticsRequest<any>('marketing', `/api/seller/analytics/marketing?period=${periodFor(filter)}`);
  const revenue = data?.revenue ?? {};
  const referral = data?.referral ?? {};
  const money = (key: string, label: string, value: unknown) => metric(key, label, cents(value ?? 0, label), 'currency');
  return {
    marketingRevenue: money('marketing_revenue', 'Marketing Revenue', revenue.marketingCents),
    emailRevenue: money('email_revenue', 'Email', revenue.emailCents),
    smsRevenue: money('sms_revenue', 'SMS', revenue.smsCents),
    discountRevenue: money('discount_revenue', 'Discounts', revenue.discountCents),
    automationRevenue: money('automation_revenue', 'Automation', revenue.automationCents),
    influencerRevenue: money('influencer_revenue', 'Influencers', revenue.influencerCents),
    referralRevenue: money('referral_revenue', 'Referrals', revenue.referralCents),
    abandonedCheckoutRecovered: money('abandoned_recovered', 'Abandoned Cart Recovered', revenue.abandonedCheckoutRecoveredCents),
    campaigns: list(data?.campaigns).map((c: any) => ({
      campaignId: String(c.campaignId ?? ''),
      name: String(c.name ?? ''),
      type: c.type === 'push' || c.type === 'sms' || c.type === 'automation' ? c.type : 'email',
      recipients: number(c.recipients),
      delivered: number(c.delivered),
      opens: number(c.opens),
      clicks: number(c.clicks),
      orders: number(c.orders),
      revenueCents: cents(c.revenueCents ?? 0, 'campaign revenue'),
      conversionRate: number(c.conversionRate),
      unsubscribes: number(c.unsubscribes),
      revenuePerRecipientCents: cents(c.revenuePerRecipientCents ?? 0, 'campaign revenue per recipient'),
      sentAt: String(c.sentAt ?? ''),
    })),
    influencers: list(data?.influencers).map((inf: any) => ({
      influencerId: String(inf.influencerId ?? ''),
      name: String(inf.name ?? ''),
      views: number(inf.views),
      clicks: number(inf.clicks),
      orders: number(inf.orders),
      revenueCents: cents(inf.revenueCents ?? 0, 'influencer revenue'),
      commissionCents: cents(inf.commissionCents ?? 0, 'influencer commission'),
      returnOnCost: number(inf.returnOnCost),
      discountUsage: number(inf.discountUsage),
    })),
    referral: {
      shares: number(referral.shares),
      clicks: number(referral.clicks),
      referredCustomers: number(referral.referredCustomers),
      orders: number(referral.orders),
      revenueCents: cents(referral.revenueCents ?? 0, 'referral revenue'),
      rewardsIssuedCents: cents(referral.rewardsIssuedCents ?? 0, 'referral rewards'),
      topAdvocates: list(referral.topAdvocates).map((a: any) => ({
        name: String(a.name ?? ''), referrals: number(a.referrals), revenueCents: cents(a.revenueCents ?? 0, 'advocate revenue'),
      })),
    },
  };
}

export async function getInventoryAnalytics(_filter?: AnalyticsFilterState): Promise<InventoryAnalytics> { return unavailable('Inventory'); }

export async function getProductionAnalytics(_filter?: AnalyticsFilterState): Promise<ProductionAnalytics> {
  // Pipeline state, not a date window, so the filter does not apply.
  const data = await analyticsRequest<any>('production', '/api/seller/analytics/production');
  return {
    activeJobs: metric('active_jobs', 'Active Jobs', number(data?.activeJobs), 'number'),
    unitsInProduction: metric('units_in_production', 'Units in Production', number(data?.unitsInProduction), 'number'),
    productionValue: metric('production_value', 'Production Value', cents(data?.productionValueCents ?? 0, 'production value'), 'currency'),
    avgLeadTimeDays: metric('avg_lead_time', 'Avg. Lead Time', number(data?.avgLeadTimeDays), 'days'),
    avgSampleTimeDays: metric('avg_sample_time', 'Avg. Sample Time', number(data?.avgSampleTimeDays), 'days'),
    onTimeCompletionRate: metric('on_time_rate', 'On-time Completion', number(data?.onTimeCompletionRate), 'percent'),
    delayedJobs: metric('delayed_jobs', 'Delayed Jobs', number(data?.delayedJobs), 'number'),
    qcFailureRate: metric('qc_failure_rate', 'Revision Rate', number(data?.qcFailureRate), 'percent'),
    avgManufacturerResponse: untracked('avg_manufacturer_response', 'Avg. Response', 'number'),
    avgUnitCost: metric('avg_unit_cost', 'Avg. Unit Cost', cents(data?.avgUnitCostCents ?? 0, 'unit cost'), 'currency'),
    manufacturers: list(data?.manufacturers).map((m: any) => ({
      manufacturerId: String(m.manufacturerId ?? ''),
      name: String(m.name ?? ''),
      productsProduced: number(m.productsProduced),
      totalUnits: number(m.totalUnits),
      totalSpend: cents(m.totalSpendCents ?? 0, 'manufacturer spend'),
      avgUnitCost: cents(m.avgUnitCostCents ?? 0, 'manufacturer unit cost'),
      avgLeadTimeDays: number(m.avgLeadTimeDays),
      delayRate: number(m.delayRate),
      qualityIssueRate: number(m.qualityIssueRate),
      sampleApprovalRate: number(m.sampleApprovalRate),
    })),
  };
}

export async function getProfitAnalytics(filter?: AnalyticsFilterState): Promise<ProfitAnalytics> {
  const data = await analyticsRequest<any>('profit', `/api/seller/analytics/profit?period=${periodFor(filter)}`);
  const money = (key: string, label: string, value: unknown) => metric(key, label, cents(value ?? 0, label), 'currency');
  const daily = list(data?.daily);
  return {
    grossRevenue: money('gross_revenue', 'Gross Revenue', data?.grossCents),
    netRevenue: money('net_revenue', 'Net Revenue', data?.netRevenueCents),
    productCost: money('product_cost', 'Product Cost', data?.productCostCents),
    manufacturerCost: money('manufacturer_cost', 'Manufacturer Cost', data?.manufacturerCostCents),
    packagingCost: untracked('packaging_cost', 'Packaging Cost', 'currency'),
    shippingCost: untracked('shipping_cost', 'Shipping Cost', 'currency'),
    platformFees: money('platform_fees', 'Platform Fees', data?.platformFeesCents),
    paymentFees: money('payment_fees', 'Payment Fees', data?.paymentFeesCents),
    refunds: money('refunds', 'Refunds', data?.refundsCents),
    marketingCost: untracked('marketing_cost', 'Marketing Cost', 'currency'),
    influencerCost: untracked('influencer_cost', 'Influencer Cost', 'currency'),
    estimatedProfit: money('estimated_profit', 'Est. Profit', data?.estimatedProfitCents),
    profitMargin: metric('profit_margin', 'Profit Margin', number(data?.profitMarginPct), 'percent'),
    lineItems: list(data?.lineItems).map((item: any) => ({
      label: String(item.label ?? ''),
      amount: cents(item.amount ?? 0, 'profit line item'),
      isEstimate: item.isEstimate === true,
      isDeduction: item.isDeduction === true,
    })),
    profitChart: daily.map((row: any) => ({ date: String(row.date ?? ''), value: cents(row.netCents ?? 0, 'daily profit') })),
    marginChart: daily.map((row: any) => ({ date: String(row.date ?? ''), value: number(row.marginPct) })),
  };
}

function payoutDate(value: unknown): string {
  if (typeof value !== 'string') return 'Not scheduled';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Not scheduled' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function getPayoutAnalytics(filter?: AnalyticsFilterState): Promise<PayoutAnalytics> {
  const data = await analyticsRequest<any>('payouts', `/api/seller/analytics/payouts?period=${periodFor(filter)}`);
  const money = (key: string, label: string, value: unknown) => metric(key, label, cents(value ?? 0, label), 'currency');
  return {
    availableBalance: money('available_balance', 'Available Balance', data?.availableCents),
    pendingBalance: money('pending_balance', 'Pending Balance', data?.pendingCents),
    heldFunds: money('held_funds', 'Held Funds', data?.heldCents),
    nextPayoutAmount: money('next_payout', 'Next Payout', data?.nextPayout?.amountCents ?? 0),
    nextPayoutDate: payoutDate(data?.nextPayout?.arrivalDate),
    totalPaidOut: money('total_paid_out', 'Total Paid Out', data?.totalPaidOutCents),
    manufacturerAllocation: money('manufacturer_allocation', 'Manufacturer Allocation', data?.manufacturerAllocationCents),
    shippingAllocation: money('shipping_allocation', 'Shipping Allocation', data?.shippingAllocationCents),
    disputeHolds: money('dispute_holds', 'Dispute Holds', data?.disputeHoldsCents),
    refundImpact: money('refund_impact', 'Refund Impact', data?.refundImpactCents),
    history: list(data?.history).map((p: any) => ({
      id: String(p.id ?? ''),
      amountCents: cents(p.amountCents ?? 0, 'payout amount'),
      status: String(p.status ?? ''),
      arrivalDate: String(p.arrivalDate ?? ''),
    })),
  };
}

export async function getAttribution(): Promise<AttributionRecord[]> { return unavailable('Attribution'); }

export async function getInsights(): Promise<AnalyticsInsight[]> { return []; }
export async function dismissInsight(_id: string): Promise<void> {}
export async function completeInsight(_id: string): Promise<void> {}
export async function exportAnalytics(_section: ExportSection, _dateRange: AnalyticsFilterState['dateRange']): Promise<AnalyticsExport> {
  return unavailable('Analytics export');
}