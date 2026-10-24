/**
 * Signed-out web preview payloads for the analytics screens. Each fixture is
 * shaped exactly like its API response so the preview runs through the same
 * mappers in analyticsService as live data. `fresh` (the default preview) is
 * a brand-new store's real zeros; `demo` (&demo=1) is a small populated store.
 * Amounts are integer cents.
 */

export type AnalyticsPreviewMode = 'demo' | 'fresh';
export type AnalyticsPreviewKey = 'revenue' | 'products' | 'marketing' | 'production' | 'profit' | 'payouts' | 'store';

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
  marketing: {
    revenue: {
      marketingCents: 0, emailCents: 0, smsCents: 0, discountCents: 0, influencerCents: 0,
      referralCents: 0, automationCents: 0, abandonedCheckoutRecoveredCents: 0,
    },
    campaigns: [], influencers: [],
    referral: { shares: 0, clicks: 0, referredCustomers: 0, orders: 0, revenueCents: 0, rewardsIssuedCents: 0, topAdvocates: [] },
  },
  production: {
    activeJobs: 0, unitsInProduction: 0, productionValueCents: 0, avgLeadTimeDays: 0, avgSampleTimeDays: 0,
    onTimeCompletionRate: 0, delayedJobs: 0, qcFailureRate: 0, avgManufacturerResponseHours: 0,
    avgUnitCostCents: 0, totalJobs: 0, manufacturers: [],
  },
  profit: {
    grossCents: 0, refundsCents: 0, taxCents: 0, platformFeesCents: 0, paymentFeesCents: 0, netRevenueCents: 0,
    productCostCents: 0, manufacturerCostCents: 0, estimatedProfitCents: 0, profitMarginPct: 0,
    lineItems: ['Gross Sales', 'Refunds', 'Platform Fees', 'Payment Processing', 'Sales Tax Collected', 'Manufacturer Cost', 'Est. Profit']
      .map((label, i, all) => ({ label, amount: 0, isEstimate: label === 'Payment Processing' || label === 'Est. Profit', isDeduction: i > 0 && i < all.length - 1 })),
    daily: [],
  },
  payouts: {
    connected: false, availableCents: 0, pendingCents: 0, heldCents: 0, releasingCents: 0, nextPayout: null,
    totalPaidOutCents: 0, manufacturerAllocationCents: 0, shippingAllocationCents: 0, disputeHoldsCents: 0,
    refundImpactCents: 0, history: [],
  },
  store: {
    visitors: 0, uniqueVisitors: 0, sessions: 0, productPageViews: 0, returningVisitors: 0, mobileTrafficPct: 0,
    addToCartRate: 0, checkoutStartRate: 0, purchaseConversion: 0, avgSessionDurationSeconds: 0,
    funnel: [
      { label: 'Store visits', count: 0, conversionPct: 0, dropOffPct: 0 },
      { label: 'Product views', count: 0, conversionPct: 0, dropOffPct: 0 },
      { label: 'Added to cart', count: 0, conversionPct: 0, dropOffPct: 0 },
      { label: 'Checkout started', count: 0, conversionPct: 0, dropOffPct: 0 },
      { label: 'Purchased', count: 0, conversionPct: 0, dropOffPct: 0 },
    ],
    trafficSources: [
      { source: 'feed', label: 'Discover feed', visits: 0, productViews: 0, sharePct: 0 },
      { source: 'search', label: 'Search', visits: 0, productViews: 0, sharePct: 0 },
      { source: 'profile', label: 'Your profile', visits: 0, productViews: 0, sharePct: 0 },
      { source: 'external', label: 'External links', visits: 0, productViews: 0, sharePct: 0 },
    ],
    daily: [],
  },
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
    case 'marketing':
      return {
        revenue: {
          marketingCents: 61800, emailCents: 24600, smsCents: 0, discountCents: 29200, influencerCents: 12400,
          referralCents: 0, automationCents: 0, abandonedCheckoutRecoveredCents: 0,
        },
        campaigns: [
          { campaignId: 'demo-email-1', name: 'Drop 02 is live', type: 'email', recipients: 412, delivered: 405, opens: 188, clicks: 41, orders: 0, revenueCents: 0, conversionRate: 0, unsubscribes: 0, revenuePerRecipientCents: 0, sentAt: isoDaysAgo(3) },
          { campaignId: 'demo-push-1', name: "We're live in 10 minutes", type: 'push', recipients: 236, delivered: 229, opens: 0, clicks: 0, orders: 0, revenueCents: 0, conversionRate: 0, unsubscribes: 0, revenuePerRecipientCents: 0, sentAt: isoDaysAgo(6) },
        ],
        influencers: [
          { influencerId: 'demo-creator-1', name: '@raestyles', views: 0, clicks: 318, orders: 5, revenueCents: 12400, commissionCents: 1240, returnOnCost: 10, discountUsage: 3 },
        ],
        referral: { shares: 0, clicks: 0, referredCustomers: 0, orders: 0, revenueCents: 0, rewardsIssuedCents: 0, topAdvocates: [] },
      };
    case 'production':
      return {
        activeJobs: 2, unitsInProduction: 250, productionValueCents: 412500, avgLeadTimeDays: 34.5, avgSampleTimeDays: 11,
        onTimeCompletionRate: 100, delayedJobs: 0, qcFailureRate: 25, avgManufacturerResponseHours: 0,
        avgUnitCostCents: 1640, totalJobs: 4,
        manufacturers: [
          { manufacturerId: 'demo-mfr-1', name: 'Porto Knit Works', productsProduced: 3, totalUnits: 204, totalSpendCents: 318000, avgUnitCostCents: 1559, avgLeadTimeDays: 34.5, delayRate: 0, qualityIssueRate: 33.3, sampleApprovalRate: 100 },
          { manufacturerId: 'demo-mfr-2', name: 'Saigon Cut & Sew', productsProduced: 1, totalUnits: 150, totalSpendCents: 262500, avgUnitCostCents: 1750, avgLeadTimeDays: 0, delayRate: 0, qualityIssueRate: 0, sampleApprovalRate: 0 },
        ],
      };
    case 'profit': {
      const gross = 174400, refunds = 6200, platform = 8720, payment = 5410, tax = 9800, mfr = 42000;
      const profit = gross - refunds - platform - payment - tax - mfr;
      return {
        grossCents: gross, refundsCents: refunds, taxCents: tax, platformFeesCents: platform, paymentFeesCents: payment,
        netRevenueCents: gross - refunds - platform - payment, productCostCents: 0, manufacturerCostCents: mfr,
        estimatedProfitCents: profit, profitMarginPct: Math.round((profit / (gross - refunds)) * 1000) / 10,
        lineItems: [
          { label: 'Gross Sales', amount: gross, isEstimate: false, isDeduction: false },
          { label: 'Refunds', amount: refunds, isEstimate: false, isDeduction: true },
          { label: 'Platform Fees', amount: platform, isEstimate: false, isDeduction: true },
          { label: 'Payment Processing', amount: payment, isEstimate: true, isDeduction: true },
          { label: 'Sales Tax Collected', amount: tax, isEstimate: false, isDeduction: true },
          { label: 'Manufacturer Cost', amount: mfr, isEstimate: false, isDeduction: true },
          { label: 'Est. Profit', amount: profit, isEstimate: true, isDeduction: false },
        ],
        daily: DEMO_DAILY_CENTS.map((cents, i) => ({
          date: isoDaysAgo(DEMO_DAILY_CENTS.length - 1 - i).slice(0, 10),
          netCents: Math.round(cents * 0.87),
          marginPct: cents > 0 ? 87 : 0,
        })),
      };
    }
    case 'payouts':
      return {
        connected: true, availableCents: 48250, pendingCents: 21900, heldCents: 36000, releasingCents: 8800,
        nextPayout: { amountCents: 48250, arrivalDate: isoDaysAgo(-2) },
        totalPaidOutCents: 131600, manufacturerAllocationCents: 12000, shippingAllocationCents: 4320,
        disputeHoldsCents: 0, refundImpactCents: 6200,
        history: [
          { id: 'demo-po-2', amountCents: 64800, status: 'paid', arrivalDate: isoDaysAgo(5), createdAt: isoDaysAgo(7) },
          { id: 'demo-po-1', amountCents: 66800, status: 'paid', arrivalDate: isoDaysAgo(12), createdAt: isoDaysAgo(14) },
        ],
      };
    case 'store':
      return {
        visitors: 1284, uniqueVisitors: 962, sessions: 1710, productPageViews: 1146, returningVisitors: 211,
        mobileTrafficPct: 82.4, addToCartRate: 9.4, checkoutStartRate: 4.7, purchaseConversion: 3.2,
        avgSessionDurationSeconds: 0,
        funnel: [
          { label: 'Store visits', count: 1710, conversionPct: 100, dropOffPct: 33 },
          { label: 'Product views', count: 1146, conversionPct: 67, dropOffPct: 92.1 },
          { label: 'Added to cart', count: 90, conversionPct: 7.9, dropOffPct: 50 },
          { label: 'Checkout started', count: 45, conversionPct: 50, dropOffPct: 31.1 },
          { label: 'Purchased', count: 31, conversionPct: 68.9, dropOffPct: 0 },
        ],
        trafficSources: [
          { source: 'feed', label: 'Discover feed', visits: 892, productViews: 640, sharePct: 52.2 },
          { source: 'profile', label: 'Your profile', visits: 401, productViews: 268, sharePct: 23.5 },
          { source: 'search', label: 'Search', visits: 288, productViews: 171, sharePct: 16.8 },
          { source: 'external', label: 'External links', visits: 129, productViews: 67, sharePct: 7.5 },
        ],
        daily: DEMO_DAILY_CENTS.map((cents, i) => ({
          date: isoDaysAgo(DEMO_DAILY_CENTS.length - 1 - i).slice(0, 10),
          visitors: 60 + Math.round(cents / 400),
        })),
      };
  }
}

export function analyticsPreviewPayload(key: AnalyticsPreviewKey, mode: AnalyticsPreviewMode): unknown {
  return mode === 'demo' ? demo(key) : FRESH[key];
}
