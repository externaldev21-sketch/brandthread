/**
 * Seller analytics reports computed from real tables — no estimates, no
 * placeholder numbers. Any metric the platform does not record is returned
 * as null so the app can hide it instead of showing a fabricated value.
 *
 * GET /api/analytics/reports/store?range=<key>       storefront traffic + funnel
 * GET /api/analytics/reports/profit?range=<key>      sales minus recorded costs
 * GET /api/analytics/reports/marketing?range=<key>   discount / creator revenue, campaigns
 * GET /api/analytics/reports/production?range=<key>  manufacturer sample + bulk orders
 *
 * range is one of the app's AnalyticsFilterState date-range keys (today,
 * yesterday, 7d, 30d, 90d, this_month, last_month, this_year, all); default 30d.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";

const router = Router();
router.use(requireAuth);
// Mounted with team context: same gate as /api/analytics/insights, so a team
// member without analytics access (staff, orders) can't read profit/fees.
router.use(requirePermission("analytics"));

export const REPORT_RANGES = [
  "today", "yesterday", "7d", "30d", "90d", "this_month", "last_month", "this_year", "all",
] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) window for a range key, in server-local calendar time. */
export function resolveReportRange(key: unknown, now = new Date()): { range: ReportRange; start: Date; end: Date } {
  const range: ReportRange = (REPORT_RANGES as readonly string[]).includes(String(key))
    ? (String(key) as ReportRange)
    : "30d";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getTime() + 1);
  switch (range) {
    case "today": return { range, start: today, end };
    case "yesterday": return { range, start: new Date(today.getTime() - DAY_MS), end: today };
    case "7d": return { range, start: new Date(today.getTime() - 6 * DAY_MS), end };
    case "90d": return { range, start: new Date(today.getTime() - 89 * DAY_MS), end };
    case "this_month": return { range, start: new Date(now.getFullYear(), now.getMonth(), 1), end };
    case "last_month": return {
      range,
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 1),
    };
    case "this_year": return { range, start: new Date(now.getFullYear(), 0, 1), end };
    case "all": return { range, start: new Date(0), end };
    default: return { range, start: new Date(today.getTime() - 29 * DAY_MS), end };
  }
}

const n = (v: unknown): number => {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
};
const rows = (r: unknown): any[] => ((r as { rows?: any[] })?.rows ?? []);
const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

// ─── Store ─────────────────────────────────────────────────────────────────

export interface StoreReportInput {
  visitors: number;          // storefront_visits rows (one per visitor per day)
  uniqueVisitors: number;
  returningVisitors: number; // visitors seen on 2+ distinct days in the range
  storeVisits: number;       // store_visits rows (every visit, incl. product screens)
  productViews: number;
  visitsWithDevice: number;
  mobileVisits: number;
  addToCartVisitors: number;
  checkoutsStarted: number;
  purchases: number;
  daily: Array<{ day: string; visitors: number }>;
}

export function buildStoreReport(i: StoreReportInput) {
  const steps = [
    { label: "Store visitors", count: i.visitors },
    { label: "Product views", count: i.productViews },
    { label: "Added to bag", count: i.addToCartVisitors },
    { label: "Checkout started", count: i.checkoutsStarted },
    { label: "Purchased", count: i.purchases },
  ];
  const funnel = steps.map((step, idx) => {
    const prev = idx === 0 ? step.count : steps[idx - 1].count;
    const next = steps[idx + 1]?.count;
    const conversionPct = prev > 0 ? Math.min(100, Math.round((step.count / prev) * 1000) / 10) : 0;
    const dropOffPct = next !== undefined && step.count > 0
      ? Math.max(0, Math.round((1 - next / step.count) * 1000) / 10)
      : 0;
    return { label: step.label, count: step.count, conversionPct, dropOffPct };
  });
  return {
    visitors: i.visitors,
    uniqueVisitors: i.uniqueVisitors,
    sessions: i.storeVisits,
    productPageViews: i.productViews,
    returningVisitors: i.returningVisitors,
    mobileTrafficPct: pct(i.mobileVisits, i.visitsWithDevice),
    addToCartRate: pct(i.addToCartVisitors, i.visitors),
    checkoutStartRate: pct(i.checkoutsStarted, i.visitors),
    purchaseConversion: pct(i.purchases, i.visitors),
    // Not recorded by the platform — returned as null, never estimated.
    avgSessionDurationSeconds: null,
    sections: [],
    funnel,
    visitorsChart: i.daily.map((d) => ({ date: d.day, value: d.visitors })),
  };
}

router.get("/store", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { range, start, end } = resolveReportRange(req.query.range);
  try {
    const [visitRows, returningRows, storeVisitRows, cartRows, checkoutRows, orderRows, dailyRows] = await Promise.all([
      db.execute(sql`
        SELECT count(*)::int AS visitors, count(DISTINCT visitor_id)::int AS unique_visitors
        FROM storefront_visits
        WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT count(*)::int AS returning FROM (
          SELECT visitor_id FROM storefront_visits
          WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
          GROUP BY visitor_id HAVING count(DISTINCT visit_date) > 1
        ) r
      `),
      db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE product_id IS NOT NULL)::int AS product_views,
               count(*) FILTER (WHERE device IS NOT NULL)::int AS with_device,
               count(*) FILTER (WHERE device IN ('ios', 'android'))::int AS mobile
        FROM store_visits
        WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT count(DISTINCT viewer_key)::int AS visitors
        FROM seller_product_events
        WHERE seller_id = ${ownerId} AND event_type = 'add_to_cart'
          AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT count(*)::int AS started FROM checkout_sessions
        WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT count(*)::int AS purchases FROM orders
        WHERE owner_id = ${ownerId} AND status != 'cancelled' AND paid_at IS NOT NULL
          AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS visitors
        FROM storefront_visits
        WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
        GROUP BY 1 ORDER BY 1
      `),
    ]);
    const v = rows(visitRows)[0] ?? {};
    const sv = rows(storeVisitRows)[0] ?? {};
    res.json({
      range,
      ...buildStoreReport({
        visitors: n(v.visitors),
        uniqueVisitors: n(v.unique_visitors),
        returningVisitors: n(rows(returningRows)[0]?.returning),
        storeVisits: n(sv.total),
        productViews: n(sv.product_views),
        visitsWithDevice: n(sv.with_device),
        mobileVisits: n(sv.mobile),
        addToCartVisitors: n(rows(cartRows)[0]?.visitors),
        checkoutsStarted: n(rows(checkoutRows)[0]?.started),
        purchases: n(rows(orderRows)[0]?.purchases),
        daily: rows(dailyRows).map((r) => ({ day: String(r.day), visitors: n(r.visitors) })),
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load store report");
    res.status(500).json({ error: "Failed to load store analytics" });
  }
});

// ─── Profit ────────────────────────────────────────────────────────────────

export interface ProfitReportInput {
  grossCents: number;
  refundedCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  shippingLabelCents: number;
  productionCents: number;
  marketingCents: number;
  creatorCommissionCents: number;
  daily: Array<{ day: string; netCents: number }>;
}

export function buildProfitReport(i: ProfitReportInput) {
  const netRevenueCents = i.grossCents - i.refundedCents - i.platformFeeCents - i.processingFeeCents;
  const profitCents = netRevenueCents - i.shippingLabelCents - i.productionCents - i.marketingCents - i.creatorCommissionCents;
  const lineItems = [
    { label: "Gross sales", amountCents: i.grossCents, isDeduction: false, isEstimate: false },
    { label: "Refunds", amountCents: i.refundedCents, isDeduction: true, isEstimate: false },
    { label: "Brandthread fees", amountCents: i.platformFeeCents, isDeduction: true, isEstimate: false },
    // Destination-charge processing fees are Stripe's estimate until settled.
    { label: "Payment processing", amountCents: i.processingFeeCents, isDeduction: true, isEstimate: true },
    { label: "Shipping labels", amountCents: i.shippingLabelCents, isDeduction: true, isEstimate: false },
    { label: "Production orders", amountCents: i.productionCents, isDeduction: true, isEstimate: false },
    { label: "Boosts & Meta ads", amountCents: i.marketingCents, isDeduction: true, isEstimate: false },
    { label: "Creator commissions", amountCents: i.creatorCommissionCents, isDeduction: true, isEstimate: false },
    { label: "Est. Profit", amountCents: profitCents, isDeduction: false, isEstimate: true },
  ];
  return {
    grossRevenueCents: i.grossCents,
    netRevenueCents,
    refundsCents: i.refundedCents,
    platformFeesCents: i.platformFeeCents,
    paymentFeesCents: i.processingFeeCents,
    shippingCostCents: i.shippingLabelCents,
    manufacturerCostCents: i.productionCents,
    marketingCostCents: i.marketingCents,
    influencerCostCents: i.creatorCommissionCents,
    // Per-unit product cost and packaging are not recorded anywhere yet.
    productCostCents: null,
    packagingCostCents: null,
    estimatedProfitCents: profitCents,
    profitMarginPct: i.grossCents > 0 ? Math.round((profitCents / i.grossCents) * 1000) / 10 : null,
    lineItems,
    netRevenueChart: i.daily.map((d) => ({ date: d.day, value: d.netCents })),
  };
}

router.get("/profit", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { range, start, end } = resolveReportRange(req.query.range);
  try {
    const [orderRows, labelRows, productionRows, boostRows, metaRows, commissionRows, dailyRows] = await Promise.all([
      db.execute(sql`
        SELECT coalesce(sum(total_cents), 0)::bigint AS gross,
               coalesce(sum(refunded_cents), 0)::bigint AS refunded,
               coalesce(sum(platform_fee_cents - platform_fee_refunded_cents), 0)::bigint AS platform_fee,
               coalesce(sum(processing_fee_charged_cents), 0)::bigint AS processing_fee
        FROM orders
        WHERE owner_id = ${ownerId} AND status != 'cancelled' AND paid_at IS NOT NULL
          AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT coalesce(sum(price_cents), 0)::bigint AS total FROM shipping_labels
        WHERE owner_id = ${ownerId} AND status = 'active'
          AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT coalesce(sum(price_cents), 0)::bigint AS total FROM sample_orders
        WHERE seller_id = ${ownerId}
          AND status IN ('payment_received','processing','cut_and_sew','packing','shipped','delivered')
          AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT coalesce(sum(spent_cents), 0)::bigint AS total FROM boosts
        WHERE seller_id = ${ownerId} AND paid_at IS NOT NULL
          AND created_at >= ${start} AND created_at < ${end}
      `),
      // Meta keeps one lifetime insights snapshot per campaign, so Meta spend
      // is attributed to the range the campaign launched in.
      db.execute(sql`
        SELECT coalesce(sum(i.spend_cents), 0)::bigint AS total
        FROM meta_campaign_insights i
        JOIN meta_campaigns c ON c.id = i.campaign_id
        WHERE c.seller_id = ${ownerId}
          AND coalesce(c.launched_at, c.created_at) >= ${start}
          AND coalesce(c.launched_at, c.created_at) < ${end}
      `),
      db.execute(sql`
        SELECT coalesce(sum(amount_cents - reversed_cents), 0)::bigint AS total FROM affiliate_commissions
        WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               coalesce(sum(total_cents - refunded_cents - (platform_fee_cents - platform_fee_refunded_cents)
                            - processing_fee_charged_cents), 0)::bigint AS net
        FROM orders
        WHERE owner_id = ${ownerId} AND status != 'cancelled' AND paid_at IS NOT NULL
          AND created_at >= ${start} AND created_at < ${end}
        GROUP BY 1 ORDER BY 1
      `),
    ]);
    const o = rows(orderRows)[0] ?? {};
    res.json({
      range,
      ...buildProfitReport({
        grossCents: n(o.gross),
        refundedCents: n(o.refunded),
        platformFeeCents: n(o.platform_fee),
        processingFeeCents: n(o.processing_fee),
        shippingLabelCents: n(rows(labelRows)[0]?.total),
        productionCents: n(rows(productionRows)[0]?.total),
        marketingCents: n(rows(boostRows)[0]?.total) + n(rows(metaRows)[0]?.total),
        creatorCommissionCents: n(rows(commissionRows)[0]?.total),
        daily: rows(dailyRows).map((r) => ({ day: String(r.day), netCents: n(r.net) })),
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load profit report");
    res.status(500).json({ error: "Failed to load profit analytics" });
  }
});

// ─── Marketing ─────────────────────────────────────────────────────────────

router.get("/marketing", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { range, start, end } = resolveReportRange(req.query.range);
  try {
    const [revenueRows, emailRows, pushRows, creatorRows] = await Promise.all([
      // One row of revenue sums. "Marketing revenue" counts each paid order
      // once even when it used both a discount code and a creator link.
      db.execute(sql`
        SELECT
          coalesce(sum(o.total_cents) FILTER (WHERE o.discount_code IS NOT NULL), 0)::bigint AS discount,
          coalesce(sum(o.total_cents) FILTER (WHERE ac.order_id IS NOT NULL), 0)::bigint AS creator,
          coalesce(sum(o.total_cents) FILTER (WHERE o.discount_code IS NOT NULL OR ac.order_id IS NOT NULL), 0)::bigint AS total
        FROM orders o
        LEFT JOIN affiliate_commissions ac ON ac.order_id = o.id
        WHERE o.owner_id = ${ownerId} AND o.status != 'cancelled' AND o.paid_at IS NOT NULL
          AND o.created_at >= ${start} AND o.created_at < ${end}
      `),
      db.execute(sql`
        SELECT c.id, c.subject, c.recipient_count, c.sent_at,
               count(s.id) FILTER (WHERE s.status = 'sent')::int AS delivered,
               count(s.opened_at)::int AS opens,
               count(s.clicked_at)::int AS clicks
        FROM email_campaigns c
        LEFT JOIN email_campaign_sends s ON s.campaign_id = c.id
        WHERE c.seller_id = ${ownerId} AND c.status = 'sent'
          AND c.sent_at >= ${start} AND c.sent_at < ${end}
        GROUP BY c.id
        ORDER BY c.sent_at DESC
        LIMIT 20
      `),
      db.execute(sql`
        SELECT id, title, recipient_count, sent_count, created_at
        FROM seller_push_broadcasts
        WHERE seller_id = ${ownerId} AND created_at >= ${start} AND created_at < ${end}
        ORDER BY created_at DESC
        LIMIT 20
      `),
      db.execute(sql`
        SELECT ac.creator_id,
               coalesce(u.display_name, u.username, 'Creator') AS name,
               count(ac.id)::int AS orders,
               coalesce(sum(ac.base_cents), 0)::bigint AS revenue,
               coalesce(sum(ac.amount_cents - ac.reversed_cents), 0)::bigint AS commission,
               (SELECT count(*)::int FROM affiliate_clicks k
                 WHERE k.seller_id = ${ownerId} AND k.creator_id = ac.creator_id
                   AND k.created_at >= ${start} AND k.created_at < ${end}) AS clicks
        FROM affiliate_commissions ac
        LEFT JOIN users u ON u.clerk_id = ac.creator_id
        WHERE ac.seller_id = ${ownerId} AND ac.created_at >= ${start} AND ac.created_at < ${end}
        GROUP BY ac.creator_id, u.display_name, u.username
        ORDER BY revenue DESC
        LIMIT 20
      `),
    ]);
    const r = rows(revenueRows)[0] ?? {};
    const campaigns = [
      ...rows(emailRows).map((c) => ({
        campaignId: String(c.id),
        name: String(c.subject || "Untitled email"),
        type: "email" as const,
        recipients: n(c.recipient_count),
        delivered: n(c.delivered),
        opens: n(c.opens),
        clicks: n(c.clicks),
        sentAt: c.sent_at ? new Date(c.sent_at).toISOString() : null,
      })),
      ...rows(pushRows).map((p) => ({
        campaignId: String(p.id),
        name: String(p.title || "Push notification"),
        type: "push" as const,
        recipients: n(p.recipient_count),
        delivered: n(p.sent_count),
        opens: null,
        clicks: null,
        sentAt: p.created_at ? new Date(p.created_at).toISOString() : null,
      })),
    ].sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));
    res.json({
      range,
      marketingRevenueCents: n(r.total),
      channels: [
        { key: "discounts", label: "Discount codes", revenueCents: n(r.discount) },
        { key: "creators", label: "Creator program", revenueCents: n(r.creator) },
      ],
      campaigns,
      influencers: rows(creatorRows).map((c) => {
        const revenueCents = n(c.revenue);
        const commissionCents = n(c.commission);
        return {
          influencerId: String(c.creator_id),
          name: String(c.name),
          clicks: n(c.clicks),
          orders: n(c.orders),
          revenueCents,
          commissionCents,
          returnOnCost: commissionCents > 0 ? Math.round((revenueCents / commissionCents) * 10) / 10 : null,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load marketing report");
    res.status(500).json({ error: "Failed to load marketing analytics" });
  }
});

// ─── Production ────────────────────────────────────────────────────────────

const PAID_STAGES = sql`('payment_received','processing','cut_and_sew','packing','shipped','delivered')`;
const ACTIVE_STAGES = sql`('payment_received','processing','cut_and_sew','packing')`;

router.get("/production", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { range, start, end } = resolveReportRange(req.query.range);
  try {
    const [activeRows, totalsRows, mfrRows] = await Promise.all([
      // Jobs still in production right now (not limited to the range).
      db.execute(sql`
        SELECT count(*)::int AS jobs, coalesce(sum(quantity), 0)::bigint AS units,
               coalesce(sum(price_cents), 0)::bigint AS value
        FROM sample_orders
        WHERE seller_id = ${ownerId} AND status IN ${ACTIVE_STAGES}
      `),
      db.execute(sql`
        SELECT
          coalesce(sum(price_cents), 0)::bigint AS spend,
          coalesce(sum(quantity), 0)::bigint AS units,
          avg(extract(epoch FROM (delivered_at - created_at)) / 86400)
            FILTER (WHERE order_type = 'bulk' AND delivered_at IS NOT NULL) AS bulk_lead_days,
          avg(extract(epoch FROM (delivered_at - created_at)) / 86400)
            FILTER (WHERE order_type = 'sample' AND delivered_at IS NOT NULL) AS sample_lead_days
        FROM sample_orders
        WHERE seller_id = ${ownerId} AND status IN ${PAID_STAGES}
          AND created_at >= ${start} AND created_at < ${end}
      `),
      db.execute(sql`
        SELECT so.manufacturer_id, m.business_name AS name,
               count(*)::int AS orders,
               coalesce(sum(so.quantity), 0)::bigint AS units,
               coalesce(sum(so.price_cents), 0)::bigint AS spend,
               avg(extract(epoch FROM (so.delivered_at - so.created_at)) / 86400)
                 FILTER (WHERE so.delivered_at IS NOT NULL) AS lead_days
        FROM sample_orders so
        LEFT JOIN manufacturers m ON m.id = so.manufacturer_id
        WHERE so.seller_id = ${ownerId} AND so.status IN ${PAID_STAGES}
          AND so.created_at >= ${start} AND so.created_at < ${end}
        GROUP BY so.manufacturer_id, m.business_name
        ORDER BY spend DESC
        LIMIT 20
      `),
    ]);
    const a = rows(activeRows)[0] ?? {};
    const t = rows(totalsRows)[0] ?? {};
    const round1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(n(v) * 10) / 10);
    const units = n(t.units);
    res.json({
      range,
      activeJobs: n(a.jobs),
      unitsInProduction: n(a.units),
      productionValueCents: n(a.value),
      spendCents: n(t.spend),
      avgUnitCostCents: units > 0 ? Math.round(n(t.spend) / units) : null,
      avgLeadTimeDays: round1(t.bulk_lead_days),
      avgSampleTimeDays: round1(t.sample_lead_days),
      // No due dates, QC results or response times are recorded per order,
      // so on-time / delay / QC / response metrics are not reported.
      onTimeCompletionRate: null,
      delayedJobs: null,
      qcFailureRate: null,
      manufacturers: rows(mfrRows).map((m) => {
        const mUnits = n(m.units);
        return {
          manufacturerId: String(m.manufacturer_id),
          name: String(m.name ?? "Manufacturer"),
          productsProduced: n(m.orders),
          totalUnits: mUnits,
          totalSpendCents: n(m.spend),
          avgUnitCostCents: mUnits > 0 ? Math.round(n(m.spend) / mUnits) : null,
          avgLeadTimeDays: round1(m.lead_days),
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load production report");
    res.status(500).json({ error: "Failed to load production analytics" });
  }
});

export default router;
