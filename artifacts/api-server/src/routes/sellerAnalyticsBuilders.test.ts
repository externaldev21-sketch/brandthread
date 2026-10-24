import { describe, expect, it } from "vitest";
import {
  buildMarketingResponse,
  buildPayoutResponse,
  buildProductionResponse,
  buildProfitResponse,
  buildSalesBreakdown,
  buildStoreResponse,
  resolveAnalyticsPeriod,
} from "./sellerAnalyticsBuilders";

describe("resolveAnalyticsPeriod", () => {
  const now = new Date(2026, 9, 24, 15, 30);

  it("defaults unknown periods to the last 30 days", () => {
    const { period, start, end } = resolveAnalyticsPeriod("bogus", now);
    expect(period).toBe("last30");
    expect(start).toEqual(new Date(2026, 8, 25, 0, 0));
    expect(end).toBe(now);
  });

  it("closes lastMonth at the first of this month", () => {
    const { start, end } = resolveAnalyticsPeriod("lastMonth", now);
    expect(start).toEqual(new Date(2026, 8, 1));
    expect(end).toEqual(new Date(2026, 9, 1));
  });
});

describe("buildSalesBreakdown", () => {
  it("is empty for a seller with no orders", () => {
    expect(buildSalesBreakdown([])).toEqual([]);
  });

  it("maps per-product units, revenue cents and share of the breakdown total", () => {
    const rows = buildSalesBreakdown([
      { product_id: "p1", name: "Tee", units: 3, revenue_cents: 7500, order_count: 2 },
      { product_id: null, name: "Old hoodie", units: "1", revenue_cents: "2500", order_count: 1 },
    ]);
    expect(rows).toEqual([
      { productId: "p1", label: "Tee", units: 3, revenueCents: 7500, orders: 2, sharePct: 75 },
      { productId: null, label: "Old hoodie", units: 1, revenueCents: 2500, orders: 1, sharePct: 25 },
    ]);
  });
});

describe("buildMarketingResponse", () => {
  it("returns well-formed zeros for an empty seller", () => {
    const body = buildMarketingResponse({
      period: "last30", channels: undefined, emailCampaigns: [], pushBroadcasts: [],
      discountCodes: [], influencers: [], unsubscribes: 0,
    });
    expect(body.revenue).toEqual({
      marketingCents: 0, emailCents: 0, smsCents: 0, discountCents: 0, influencerCents: 0,
      referralCents: 0, automationCents: 0, abandonedCheckoutRecoveredCents: 0,
    });
    expect(body.campaigns).toEqual([]);
    expect(body.influencers).toEqual([]);
    expect(body.referral.revenueCents).toBe(0);
  });

  it("merges email and push campaigns newest first and computes creator return on cost", () => {
    const body = buildMarketingResponse({
      period: "last30",
      channels: { marketing_cents: "12000", marketing_orders: 3, email_cents: 4000, discount_cents: 5000, influencer_cents: 3000 },
      emailCampaigns: [{ id: "e1", subject: "Drop 02", sent_at: "2026-10-02T10:00:00.000Z", recipient_count: 200, delivered: 190, opens: 80, clicks: 12 }],
      pushBroadcasts: [{ id: "b1", title: "Live now", recipient_count: 50, sent_count: 48, created_at: new Date("2026-10-05T10:00:00.000Z") }],
      discountCodes: [{ code: "FALL10", orders: 2, revenue_cents: 5000, discount_cents: 500 }],
      influencers: [{ affiliate_id: "a1", name: "Rae", orders: 1, revenue_cents: 3000, commission_cents: 300, clicks: 40, discount_uses: 1 }],
      unsubscribes: 2,
    });
    expect(body.revenue.marketingCents).toBe(12000);
    expect(body.attributedOrders).toBe(3);
    expect(body.campaigns.map((c) => [c.campaignId, c.type])).toEqual([["b1", "push"], ["e1", "email"]]);
    expect(body.campaigns[1]).toMatchObject({ recipients: 200, delivered: 190, opens: 80, clicks: 12 });
    expect(body.influencers[0]).toMatchObject({ revenueCents: 3000, commissionCents: 300, returnOnCost: 10, discountUsage: 1 });
    expect(body.discountCodes[0]).toEqual({ code: "FALL10", orders: 2, revenueCents: 5000, discountCents: 500 });
  });
});

describe("buildProductionResponse", () => {
  const now = new Date("2026-10-24T00:00:00.000Z");

  it("returns well-formed zeros for a seller with no manufacturer orders", () => {
    expect(buildProductionResponse([], now)).toEqual({
      activeJobs: 0, unitsInProduction: 0, productionValueCents: 0, avgLeadTimeDays: 0,
      avgSampleTimeDays: 0, onTimeCompletionRate: 0, delayedJobs: 0, qcFailureRate: 0,
      avgManufacturerResponseHours: 0, avgUnitCostCents: 0, totalJobs: 0, manufacturers: [],
    });
  });

  it("aggregates active jobs, lead times and per-manufacturer spend", () => {
    const body = buildProductionResponse([
      { manufacturer_id: "m1", manufacturer_name: "Loom Co", order_type: "sample", status: "delivered", quantity: 2, price_cents: 4000,
        created_at: "2026-09-01T00:00:00.000Z", delivered_at: "2026-09-11T00:00:00.000Z", revision: 1 },
      { manufacturer_id: "m1", manufacturer_name: "Loom Co", order_type: "bulk", status: "cut_and_sew", quantity: 100, price_cents: 150000,
        created_at: "2026-10-01T00:00:00.000Z", delivered_at: null, revision: 2 },
      { manufacturer_id: "m2", manufacturer_name: "Knit Lab", order_type: "bulk", status: "processing", quantity: 50, price_cents: 50000,
        created_at: "2026-07-01T00:00:00.000Z", delivered_at: null, revision: 1 },
    ], now);
    expect(body.activeJobs).toBe(2);
    expect(body.unitsInProduction).toBe(150);
    expect(body.productionValueCents).toBe(200000);
    expect(body.avgSampleTimeDays).toBe(10);
    expect(body.onTimeCompletionRate).toBe(100);
    expect(body.delayedJobs).toBe(1); // the July bulk job, >60 days open
    expect(body.avgUnitCostCents).toBe(Math.round(204000 / 152));
    expect(body.manufacturers.map((m) => m.manufacturerId)).toEqual(["m1", "m2"]);
    expect(body.manufacturers[0]).toMatchObject({
      name: "Loom Co", productsProduced: 2, totalUnits: 102, totalSpendCents: 154000,
      sampleApprovalRate: 100, qualityIssueRate: 50,
    });
  });
});

describe("buildProfitResponse", () => {
  it("returns zeros and an all-zero waterfall for an empty seller", () => {
    const body = buildProfitResponse({ period: "last30", totals: undefined, daily: [], manufacturerCostCents: 0 });
    expect(body.grossCents).toBe(0);
    expect(body.estimatedProfitCents).toBe(0);
    expect(body.profitMarginPct).toBe(0);
    expect(body.lineItems.every((item) => item.amount === 0)).toBe(true);
    expect(body.daily).toEqual([]);
  });

  it("subtracts refunds, fees, tax and manufacturer cost", () => {
    const body = buildProfitResponse({
      period: "last30",
      totals: { gross_cents: "20000", refunded_cents: 2000, tax_cents: 1000, platform_fee_cents: 1000, processing_fee_cents: 600, order_count: 4 },
      daily: [{ day: "2026-10-20T00:00:00.000Z", gross_cents: 20000, refunded_cents: 2000, tax_cents: 1000, platform_fee_cents: 1000, processing_fee_cents: 600 }],
      manufacturerCostCents: 5000,
    });
    expect(body.netRevenueCents).toBe(20000 - 2000 - 1000 - 600);
    expect(body.estimatedProfitCents).toBe(16400 - 1000 - 5000);
    expect(body.profitMarginPct).toBe(Math.round((10400 / 18000) * 1000) / 10);
    expect(body.lineItems.at(-1)).toEqual({ label: "Est. Profit", amount: 10400, isEstimate: true, isDeduction: false });
    expect(body.daily).toEqual([{ date: "2026-10-20", netCents: 15400, marginPct: Math.round((15400 / 18000) * 1000) / 10 }]);
  });
});

describe("buildPayoutResponse", () => {
  it("returns zeros for an unconnected seller with no ledger activity", () => {
    expect(buildPayoutResponse({
      ledger: undefined, releases: undefined, orderImpact: undefined, stripe: null, connected: false, stripeError: false,
    })).toEqual({
      connected: false, stripeError: false, availableCents: 0, pendingCents: 0, heldCents: 0, releasingCents: 0,
      nextPayout: null, totalPaidOutCents: 0, manufacturerAllocationCents: 0, shippingAllocationCents: 0,
      disputeHoldsCents: 0, refundImpactCents: 0, history: [],
    });
  });

  it("prefers Stripe's paid-out total and falls back to the ledger", () => {
    const base = {
      ledger: { held_cents: "3000", paid_out_cents: "9000" },
      releases: { releasing_cents: 1200, bulk_share_cents: 400, label_cents: 600 },
      orderImpact: { dispute_hold_cents: 2500, refunded_cents: 700 },
      connected: true, stripeError: false,
    };
    expect(buildPayoutResponse({ ...base, stripe: null })).toMatchObject({
      heldCents: 3000, totalPaidOutCents: 9000, releasingCents: 1200,
      manufacturerAllocationCents: 400, shippingAllocationCents: 600, disputeHoldsCents: 2500, refundImpactCents: 700,
    });
    const live = buildPayoutResponse({
      ...base,
      stripe: {
        availableCents: 5000, pendingCents: 800, paidOutCents: 8800,
        nextPayout: { amountCents: 5000, arrivalDate: "2026-10-26T00:00:00.000Z" },
        history: [{ id: "po_1", amountCents: 8800, status: "paid", arrivalDate: "2026-10-10T00:00:00.000Z", createdAt: "2026-10-08T00:00:00.000Z" }],
      },
    });
    expect(live).toMatchObject({ availableCents: 5000, pendingCents: 800, totalPaidOutCents: 8800 });
    expect(live.history).toHaveLength(1);
  });
});

describe("buildStoreResponse", () => {
  it("returns zeros with every traffic source present for an empty seller", () => {
    const body = buildStoreResponse({
      period: "last30", visitors: undefined, visits: undefined, sources: [], daily: [],
      addToCart: 0, checkoutStarts: 0, orders: 0, linkClicks: [],
    });
    expect(body.visitors).toBe(0);
    expect(body.trafficSources.map((s) => s.source).sort()).toEqual(["external", "feed", "profile", "search"]);
    expect(body.trafficSources.every((s) => s.visits === 0 && s.sharePct === 0)).toBe(true);
    expect(body.funnel.every((step) => step.count === 0 && step.conversionPct === 0 && step.dropOffPct === 0)).toBe(true);
  });

  it("computes funnel steps, rates and source shares", () => {
    const body = buildStoreResponse({
      period: "last30",
      visitors: { visitor_days: 60, unique_visitors: 40, returning_visitors: 10 },
      visits: { sessions: 100, product_views: 50, device_known: 80, mobile: 60 },
      sources: [{ source: "feed", visits: 70, product_views: 30 }, { source: "search", visits: 30, product_views: 20 }],
      daily: [{ day: "2026-10-01T00:00:00.000Z", visitors: 5 }],
      addToCart: 10, checkoutStarts: 5, orders: 4,
      linkClicks: [{ label: "instagram.com", clicks: 9 }],
    });
    expect(body).toMatchObject({
      visitors: 60, uniqueVisitors: 40, sessions: 100, productPageViews: 50, returningVisitors: 10,
      mobileTrafficPct: 75, addToCartRate: 25, checkoutStartRate: 12.5, purchaseConversion: 10,
    });
    expect(body.funnel.map((s) => [s.count, s.conversionPct, s.dropOffPct])).toEqual([
      [100, 100, 50], [50, 50, 80], [10, 20, 50], [5, 50, 20], [4, 80, 0],
    ]);
    expect(body.trafficSources[0]).toMatchObject({ source: "feed", label: "Discover feed", visits: 70, sharePct: 70 });
    expect(body.daily).toEqual([{ date: "2026-10-01", visitors: 5 }]);
    expect(body.topReferrers).toEqual([{ label: "instagram.com", clicks: 9 }]);
  });
});
