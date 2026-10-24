/**
 * Pure response builders for /api/seller/analytics/*. The router runs the
 * seller-scoped SQL; these functions turn its rows into the response, so the
 * aggregation (sums, rates, shares, empty-seller zeros) is unit-testable
 * without a database. Every money field is integer cents.
 */

type DbRow = Record<string, unknown>;

export const ANALYTICS_PERIODS = ["today", "last7", "last30", "last90", "thisMonth", "lastMonth"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

function startOfDay(d: Date, daysBack: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - daysBack);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Same windows as GET /api/analytics/revenue, plus an explicit end. */
export function resolveAnalyticsPeriod(raw: unknown, now = new Date()): { period: AnalyticsPeriod; start: Date; end: Date } {
  const period: AnalyticsPeriod = (ANALYTICS_PERIODS as readonly string[]).includes(String(raw))
    ? (String(raw) as AnalyticsPeriod)
    : "last30";
  switch (period) {
    case "today":     return { period, start: startOfDay(now, 0), end: now };
    case "last7":     return { period, start: startOfDay(now, 6), end: now };
    case "last90":    return { period, start: startOfDay(now, 89), end: now };
    case "thisMonth": return { period, start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    case "lastMonth": return {
      period,
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 1),
    };
    default:          return { period, start: startOfDay(now, 29), end: now };
  }
}

export function int(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value.length > 0 ? value : null;
}

function day(value: unknown): string {
  return (iso(value) ?? "").slice(0, 10);
}

/** Percentage with one decimal; 0 when the denominator is 0. */
export function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ─── Sales: per-product breakdown ─────────────────────────────────────────────

export function buildSalesBreakdown(rows: readonly DbRow[]) {
  const mapped = rows.map((row) => ({
    productId: str(row.product_id) || null,
    label: str(row.name, "Unknown product"),
    revenueCents: int(row.revenue_cents),
    units: int(row.units),
    orders: int(row.order_count),
  }));
  const total = mapped.reduce((sum, row) => sum + row.revenueCents, 0);
  return mapped.map((row) => ({ ...row, sharePct: pct(row.revenueCents, total) }));
}

// ─── Marketing ────────────────────────────────────────────────────────────────

export function buildMarketingResponse(input: {
  period: AnalyticsPeriod;
  channels: DbRow | undefined;
  emailCampaigns: readonly DbRow[];
  pushBroadcasts: readonly DbRow[];
  discountCodes: readonly DbRow[];
  influencers: readonly DbRow[];
  unsubscribes: number;
}) {
  const c = input.channels ?? {};
  const campaigns = [
    ...input.emailCampaigns.map((row) => {
      const recipients = int(row.recipient_count);
      return {
        campaignId: str(row.id),
        name: str(row.subject, "Untitled email"),
        type: "email" as const,
        recipients,
        delivered: int(row.delivered),
        opens: int(row.opens),
        clicks: int(row.clicks),
        // Email links carry no per-campaign order attribution today.
        orders: 0,
        revenueCents: 0,
        conversionRate: 0,
        unsubscribes: 0,
        revenuePerRecipientCents: 0,
        sentAt: iso(row.sent_at) ?? "",
      };
    }),
    ...input.pushBroadcasts.map((row) => ({
      campaignId: str(row.id),
      name: str(row.title, "Push broadcast"),
      type: "push" as const,
      recipients: int(row.recipient_count),
      delivered: int(row.sent_count),
      opens: 0,
      clicks: 0,
      orders: 0,
      revenueCents: 0,
      conversionRate: 0,
      unsubscribes: 0,
      revenuePerRecipientCents: 0,
      sentAt: iso(row.created_at) ?? "",
    })),
  ].sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  const influencers = input.influencers.map((row) => {
    const revenueCents = int(row.revenue_cents);
    const commissionCents = int(row.commission_cents);
    return {
      influencerId: str(row.affiliate_id),
      name: str(row.name, "Creator"),
      views: 0,
      clicks: int(row.clicks),
      orders: int(row.orders),
      revenueCents,
      commissionCents,
      returnOnCost: commissionCents > 0 ? round1(revenueCents / commissionCents) : 0,
      discountUsage: int(row.discount_uses),
    };
  });

  return {
    period: input.period,
    revenue: {
      // Distinct attributed orders: an order with both a code and a creator
      // link is counted once here, but in both channel rows below.
      marketingCents: int(c.marketing_cents),
      emailCents: int(c.email_cents),
      smsCents: int(c.sms_cents),
      discountCents: int(c.discount_cents),
      influencerCents: int(c.influencer_cents),
      referralCents: int(c.referral_cents),
      // No automation flows or abandoned-checkout recovery exist yet.
      automationCents: 0,
      abandonedCheckoutRecoveredCents: 0,
    },
    attributedOrders: int(c.marketing_orders),
    campaigns,
    discountCodes: input.discountCodes.map((row) => ({
      code: str(row.code),
      orders: int(row.orders),
      revenueCents: int(row.revenue_cents),
      discountCents: int(row.discount_cents),
    })),
    influencers,
    referral: {
      shares: 0,
      clicks: int(c.referral_clicks),
      referredCustomers: int(c.referral_customers),
      orders: int(c.referral_orders),
      revenueCents: int(c.referral_cents),
      rewardsIssuedCents: 0,
      topAdvocates: [] as Array<{ name: string; referrals: number; revenueCents: number }>,
    },
    unsubscribes: input.unsubscribes,
  };
}

// ─── Production ───────────────────────────────────────────────────────────────

export function buildProductionResponse(rows: readonly DbRow[], now = new Date()) {
  type Job = {
    manufacturerId: string; name: string; orderType: string; status: string;
    quantity: number; priceCents: number; createdAt: Date | null; deliveredAt: Date | null;
    revision: number;
  };
  const jobs: Job[] = rows.map((row) => ({
    manufacturerId: str(row.manufacturer_id),
    name: str(row.manufacturer_name, "Manufacturer"),
    orderType: str(row.order_type, "sample"),
    status: str(row.status, "payment_received"),
    quantity: int(row.quantity),
    priceCents: int(row.price_cents),
    createdAt: iso(row.created_at) ? new Date(iso(row.created_at)!) : null,
    deliveredAt: iso(row.delivered_at) ? new Date(iso(row.delivered_at)!) : null,
    revision: int(row.revision) || 1,
  }));

  const daysBetween = (a: Date | null, b: Date | null) =>
    a && b ? Math.max(0, (b.valueOf() - a.valueOf()) / 86_400_000) : null;
  const avg = (values: number[]) =>
    values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : 0;

  const active = jobs.filter((j) => j.status !== "delivered");
  const delivered = jobs.filter((j) => j.status === "delivered");
  const leadTimes = (list: Job[]) => list.flatMap((j) => {
    const d = daysBetween(j.createdAt, j.deliveredAt);
    return d === null ? [] : [d];
  });
  // No promised dates exist on sample orders, so "delayed" is an open job
  // older than the platform's 60-day pre-order delivery window.
  const DELAY_DAYS = 60;
  const delayed = active.filter((j) => (daysBetween(j.createdAt, now) ?? 0) > DELAY_DAYS);
  const lateDelivered = delivered.filter((j) => (daysBetween(j.createdAt, j.deliveredAt) ?? 0) > DELAY_DAYS);
  const reworked = jobs.filter((j) => j.revision > 1);
  const totalUnits = jobs.reduce((s, j) => s + j.quantity, 0);
  const totalSpend = jobs.reduce((s, j) => s + j.priceCents, 0);

  const byManufacturer = new Map<string, Job[]>();
  for (const job of jobs) {
    const list = byManufacturer.get(job.manufacturerId) ?? [];
    list.push(job);
    byManufacturer.set(job.manufacturerId, list);
  }
  const manufacturers = [...byManufacturer.entries()].map(([manufacturerId, list]) => {
    const units = list.reduce((s, j) => s + j.quantity, 0);
    const spend = list.reduce((s, j) => s + j.priceCents, 0);
    const done = list.filter((j) => j.status === "delivered");
    const samples = list.filter((j) => j.orderType === "sample");
    const lateCount = list.filter((j) => j.status === "delivered"
      ? (daysBetween(j.createdAt, j.deliveredAt) ?? 0) > DELAY_DAYS
      : (daysBetween(j.createdAt, now) ?? 0) > DELAY_DAYS).length;
    return {
      manufacturerId,
      name: list[0].name,
      productsProduced: list.length,
      totalUnits: units,
      totalSpendCents: spend,
      avgUnitCostCents: units > 0 ? Math.round(spend / units) : 0,
      avgLeadTimeDays: avg(leadTimes(done)),
      delayRate: pct(lateCount, list.length),
      qualityIssueRate: pct(list.filter((j) => j.revision > 1).length, list.length),
      sampleApprovalRate: pct(samples.filter((j) => j.status === "delivered").length, samples.length),
    };
  }).sort((a, b) => b.totalSpendCents - a.totalSpendCents);

  return {
    activeJobs: active.length,
    unitsInProduction: active.reduce((s, j) => s + j.quantity, 0),
    productionValueCents: active.reduce((s, j) => s + j.priceCents, 0),
    avgLeadTimeDays: avg(leadTimes(delivered.filter((j) => j.orderType === "bulk"))),
    avgSampleTimeDays: avg(leadTimes(delivered.filter((j) => j.orderType === "sample"))),
    onTimeCompletionRate: delivered.length ? pct(delivered.length - lateDelivered.length, delivered.length) : 0,
    delayedJobs: delayed.length,
    // Revised order cards are the only rework signal recorded.
    qcFailureRate: pct(reworked.length, jobs.length),
    avgManufacturerResponseHours: 0,
    avgUnitCostCents: totalUnits > 0 ? Math.round(totalSpend / totalUnits) : 0,
    totalJobs: jobs.length,
    manufacturers,
  };
}

// ─── Profit ───────────────────────────────────────────────────────────────────

export function buildProfitResponse(input: {
  period: AnalyticsPeriod;
  totals: DbRow | undefined;
  daily: readonly DbRow[];
  manufacturerCostCents: number;
}) {
  const t = input.totals ?? {};
  const grossCents = int(t.gross_cents);
  const refundsCents = int(t.refunded_cents);
  const taxCents = int(t.tax_cents);
  const shippingCents = int(t.shipping_cents);
  const platformFeesCents = int(t.platform_fee_cents);
  const paymentFeesCents = int(t.processing_fee_cents);
  const discountsCents = int(t.discount_cents);
  const manufacturerCostCents = input.manufacturerCostCents;
  const netRevenueCents = grossCents - refundsCents - platformFeesCents - paymentFeesCents;
  const profitCents = netRevenueCents - taxCents - manufacturerCostCents;
  const marginBase = grossCents - refundsCents;

  const lineItems = [
    { label: "Gross Sales", amount: grossCents, isEstimate: false, isDeduction: false },
    { label: "Refunds", amount: refundsCents, isEstimate: false, isDeduction: true },
    { label: "Platform Fees", amount: platformFeesCents, isEstimate: false, isDeduction: true },
    { label: "Payment Processing", amount: paymentFeesCents, isEstimate: true, isDeduction: true },
    { label: "Sales Tax Collected", amount: taxCents, isEstimate: false, isDeduction: true },
    { label: "Manufacturer Cost", amount: manufacturerCostCents, isEstimate: false, isDeduction: true },
    { label: "Est. Profit", amount: profitCents, isEstimate: true, isDeduction: false },
  ];

  return {
    period: input.period,
    orderCount: int(t.order_count),
    grossCents,
    refundsCents,
    discountsCents,
    shippingCents,
    taxCents,
    platformFeesCents,
    paymentFeesCents,
    netRevenueCents,
    // No per-product cost is stored; manufacturer orders are the only cost.
    productCostCents: 0,
    productCostKnown: false,
    manufacturerCostCents,
    estimatedProfitCents: profitCents,
    profitMarginPct: pct(profitCents, marginBase),
    lineItems,
    daily: input.daily.map((row) => {
      const gross = int(row.gross_cents);
      const refunded = int(row.refunded_cents);
      const net = gross - refunded - int(row.platform_fee_cents) - int(row.processing_fee_cents) - int(row.tax_cents);
      return { date: day(row.day), netCents: net, marginPct: pct(net, gross - refunded) };
    }),
  };
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

export function buildPayoutResponse(input: {
  ledger: DbRow | undefined;
  releases: DbRow | undefined;
  orderImpact: DbRow | undefined;
  stripe: {
    availableCents: number;
    pendingCents: number;
    paidOutCents: number;
    nextPayout: { amountCents: number; arrivalDate: string } | null;
    history: Array<{ id: string; amountCents: number; status: string; arrivalDate: string; createdAt: string }>;
  } | null;
  connected: boolean;
  stripeError: boolean;
}) {
  const l = input.ledger ?? {};
  const r = input.releases ?? {};
  const o = input.orderImpact ?? {};
  const ledgerPaidOut = int(l.paid_out_cents);
  return {
    connected: input.connected,
    stripeError: input.stripeError,
    availableCents: input.stripe?.availableCents ?? 0,
    pendingCents: input.stripe?.pendingCents ?? 0,
    heldCents: Math.max(0, int(l.held_cents)),
    releasingCents: int(r.releasing_cents),
    nextPayout: input.stripe?.nextPayout ?? null,
    // Stripe's own record of money sent to the bank wins; the ledger (what
    // Brandthread transferred to the seller) is the fallback.
    totalPaidOutCents: input.stripe ? input.stripe.paidOutCents : ledgerPaidOut,
    manufacturerAllocationCents: int(r.bulk_share_cents),
    shippingAllocationCents: int(r.label_cents),
    disputeHoldsCents: int(o.dispute_hold_cents),
    refundImpactCents: int(o.refunded_cents),
    history: input.stripe?.history ?? [],
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const TRAFFIC_SOURCE_LABELS: Record<string, string> = {
  feed: "Discover feed",
  search: "Search",
  profile: "Your profile",
  external: "External links",
};

export function buildStoreResponse(input: {
  period: AnalyticsPeriod;
  visitors: DbRow | undefined;
  visits: DbRow | undefined;
  sources: readonly DbRow[];
  daily: readonly DbRow[];
  addToCart: number;
  checkoutStarts: number;
  orders: number;
  linkClicks: readonly DbRow[];
}) {
  const v = input.visitors ?? {};
  const s = input.visits ?? {};
  const visitorDays = int(v.visitor_days);
  const uniqueVisitors = int(v.unique_visitors);
  const returningVisitors = int(v.returning_visitors);
  const sessions = int(s.sessions);
  const productViews = int(s.product_views);
  const deviceKnown = int(s.device_known);
  const mobile = int(s.mobile);

  const bySource = new Map(input.sources.map((row) => [str(row.source), row]));
  const trafficSources = Object.keys(TRAFFIC_SOURCE_LABELS).map((source) => {
    const row = bySource.get(source) ?? {};
    const visits = int(row.visits);
    return {
      source,
      label: TRAFFIC_SOURCE_LABELS[source],
      visits,
      productViews: int(row.product_views),
      sharePct: pct(visits, sessions),
    };
  }).sort((a, b) => b.visits - a.visits);

  const steps = [
    { label: "Store visits", count: sessions },
    { label: "Product views", count: productViews },
    { label: "Added to cart", count: input.addToCart },
    { label: "Checkout started", count: input.checkoutStarts },
    { label: "Purchased", count: input.orders },
  ];
  const conversions = steps.map((step, i) =>
    // Steps come from separate event tables, so a later step can out-count
    // an earlier one; cap the step rate rather than show >100%.
    i === 0 ? (step.count > 0 ? 100 : 0) : Math.min(100, pct(step.count, steps[i - 1].count)));
  // dropOffPct is the loss *out of* a step, which is how the screen reads it
  // (shown under every step but the last).
  const funnel = steps.map((step, i) => ({
    ...step,
    conversionPct: conversions[i],
    dropOffPct: i < steps.length - 1 && step.count > 0 ? round1(Math.max(0, 100 - conversions[i + 1])) : 0,
  }));

  return {
    period: input.period,
    visitors: visitorDays,
    uniqueVisitors,
    sessions,
    productPageViews: productViews,
    returningVisitors,
    mobileTrafficPct: pct(mobile, deviceKnown),
    addToCartRate: pct(input.addToCart, uniqueVisitors),
    checkoutStartRate: pct(input.checkoutStarts, uniqueVisitors),
    purchaseConversion: pct(input.orders, uniqueVisitors),
    // Session length is not recorded.
    avgSessionDurationSeconds: 0,
    funnel,
    trafficSources,
    topReferrers: input.linkClicks.map((row) => ({ label: str(row.label, "Direct"), clicks: int(row.clicks) })),
    daily: input.daily.map((row) => ({ date: day(row.day), visitors: int(row.visitors) })),
  };
}
