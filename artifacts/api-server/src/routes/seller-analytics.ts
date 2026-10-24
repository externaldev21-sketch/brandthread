/**
 * Seller analytics backends for the mobile Marketing, Production, Profit &
 * Payout and Store Analytics screens. Mounted at /api/seller/analytics.
 *
 * GET /marketing?period=   campaign performance + attributed revenue by channel
 * GET /production          sample/bulk manufacturer order pipeline
 * GET /profit?period=      revenue − refunds − fees, manufacturer cost, margin
 * GET /payouts?period=     balance, holds, allocations, payout history
 * GET /store?period=       visits, funnel, traffic sources
 *
 * Every figure is a real aggregate of the seller's own rows (store owner via
 * team context); a seller with no data gets well-formed zeros, never an
 * error. Money is integer cents. `period` matches /api/analytics/revenue.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePayoutsRead, requirePermission } from "../middlewares/requireRole";
import { stripe } from "../lib/stripe";
import { cashOutableAmount } from "../lib/payoutSafety";
import {
  buildMarketingResponse,
  buildPayoutResponse,
  buildProductionResponse,
  buildProfitResponse,
  buildStoreResponse,
  int,
  resolveAnalyticsPeriod,
} from "./sellerAnalyticsBuilders";

const router = Router();
router.use(requireAuth);
router.use(requirePermission("analytics"));

type Rows = Record<string, unknown>[];
const rowsOf = (result: unknown): Rows => ((result as { rows?: Rows }).rows ?? []) as Rows;
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;
const tstz = (d: Date) => sql`${d.toISOString()}::timestamptz`;
// The store being viewed. Read from the resolved team context first: a
// mount-level teamContext() is cached on req, and requireAuth above resets
// clerkUserId to the caller after it ran.
const sellerOf = (req: unknown) => {
  const r = req as { clerkUserId: string; teamContext?: { storeOwnerId: string } };
  return r.teamContext?.storeOwnerId ?? r.clerkUserId;
};
// Same "real sale" predicate the seller dashboard uses.
const PAID = sql`o.status NOT IN ('cancelled', 'refund_pending') AND o.paid_at IS NOT NULL`;

// ─── GET /marketing ───────────────────────────────────────────────────────────

router.get("/marketing", async (req, res) => {
  const sellerId = sellerOf(req);
  const { period, start, end } = resolveAnalyticsPeriod(req.query.period);
  try {
    const [channels, emailCampaigns, pushBroadcasts, discountCodes, influencers, unsubscribes] = await Promise.all([
      // One row per paid order in range with every channel signal it carries:
      // a discount code, a tracked-link UTM medium, an affiliate commission.
      db.execute(sql`
        WITH o AS (
          SELECT o.id, o.buyer_id,
                 GREATEST(o.total_cents - o.refunded_cents, 0) AS net,
                 (coalesce(o.discount_code, '') <> '') AS has_discount,
                 lower(coalesce(ca.utm_medium, '')) AS medium,
                 (ac.order_id IS NOT NULL) AS has_affiliate
          FROM orders o
          LEFT JOIN checkout_attributions ca
            ON ca.stripe_session_id = o.stripe_checkout_session_id AND ca.seller_id = o.owner_id
          LEFT JOIN affiliate_commissions ac ON ac.order_id = o.id AND ac.seller_id = o.owner_id
          WHERE o.owner_id = ${sellerId} AND ${PAID}
            AND o.created_at >= ${ts(start)} AND o.created_at < ${ts(end)}
        )
        SELECT
          coalesce(sum(net) FILTER (WHERE has_discount OR has_affiliate OR medium <> ''), 0)::bigint AS marketing_cents,
          count(*) FILTER (WHERE has_discount OR has_affiliate OR medium <> '')::int AS marketing_orders,
          coalesce(sum(net) FILTER (WHERE medium = 'email'), 0)::bigint AS email_cents,
          coalesce(sum(net) FILTER (WHERE medium = 'sms'), 0)::bigint AS sms_cents,
          coalesce(sum(net) FILTER (WHERE has_discount), 0)::bigint AS discount_cents,
          coalesce(sum(net) FILTER (WHERE has_affiliate), 0)::bigint AS influencer_cents,
          coalesce(sum(net) FILTER (WHERE medium = 'referral' AND NOT has_affiliate), 0)::bigint AS referral_cents,
          count(*) FILTER (WHERE medium = 'referral' AND NOT has_affiliate)::int AS referral_orders,
          count(DISTINCT buyer_id) FILTER (WHERE medium = 'referral' AND NOT has_affiliate)::int AS referral_customers,
          (SELECT count(*)::int FROM link_clicks lc JOIN tracked_links tl ON tl.id = lc.link_id
             WHERE lc.seller_id = ${sellerId} AND lower(coalesce(tl.utm_medium, '')) = 'referral'
               AND lc.created_at >= ${ts(start)} AND lc.created_at < ${ts(end)}) AS referral_clicks
        FROM o
      `),
      db.execute(sql`
        SELECT c.id, c.subject, c.sent_at, c.recipient_count,
               count(s.delivered_at)::int AS delivered,
               count(s.opened_at)::int AS opens,
               count(s.clicked_at)::int AS clicks
        FROM email_campaigns c
        LEFT JOIN email_campaign_sends s ON s.campaign_id = c.id AND s.seller_id = c.seller_id
        WHERE c.seller_id = ${sellerId} AND c.status = 'sent'
          AND c.sent_at >= ${tstz(start)} AND c.sent_at < ${tstz(end)}
        GROUP BY c.id
        ORDER BY c.sent_at DESC
        LIMIT 20
      `),
      db.execute(sql`
        SELECT id, title, recipient_count, sent_count, created_at
        FROM seller_push_broadcasts
        WHERE seller_id = ${sellerId}
          AND created_at >= ${tstz(start)} AND created_at < ${tstz(end)}
        ORDER BY created_at DESC
        LIMIT 20
      `),
      db.execute(sql`
        SELECT o.discount_code AS code, count(*)::int AS orders,
               coalesce(sum(GREATEST(o.total_cents - o.refunded_cents, 0)), 0)::bigint AS revenue_cents,
               coalesce(sum(o.discount_amount_cents), 0)::bigint AS discount_cents
        FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND coalesce(o.discount_code, '') <> ''
          AND o.created_at >= ${ts(start)} AND o.created_at < ${ts(end)}
        GROUP BY o.discount_code
        ORDER BY revenue_cents DESC
        LIMIT 10
      `),
      db.execute(sql`
        SELECT ac.affiliate_id,
               coalesce(u.display_name, u.username, u.name) AS name,
               count(*)::int AS orders,
               coalesce(sum(ac.base_cents), 0)::bigint AS revenue_cents,
               coalesce(sum(ac.amount_cents - ac.reversed_cents), 0)::bigint AS commission_cents,
               (SELECT count(*)::int FROM affiliate_clicks k
                  WHERE k.affiliate_id = ac.affiliate_id
                    AND k.created_at >= ${tstz(start)} AND k.created_at < ${tstz(end)}) AS clicks,
               (SELECT count(*)::int FROM discount_code_uses du
                  JOIN affiliate_creators cr ON cr.discount_code_id = du.discount_code_id
                  WHERE cr.id = ac.affiliate_id
                    AND du.used_at >= ${ts(start)} AND du.used_at < ${ts(end)}) AS discount_uses
        FROM affiliate_commissions ac
        LEFT JOIN users u ON u.clerk_id = ac.creator_id
        WHERE ac.seller_id = ${sellerId}
          AND ac.created_at >= ${tstz(start)} AND ac.created_at < ${tstz(end)}
        GROUP BY ac.affiliate_id, u.display_name, u.username, u.name
        ORDER BY revenue_cents DESC
        LIMIT 10
      `),
      db.execute(sql`
        SELECT count(*)::int AS n FROM email_subscribers
        WHERE seller_id = ${sellerId}
          AND unsubscribed_at >= ${tstz(start)} AND unsubscribed_at < ${tstz(end)}
      `),
    ]);
    res.json(buildMarketingResponse({
      period,
      channels: rowsOf(channels)[0],
      emailCampaigns: rowsOf(emailCampaigns),
      pushBroadcasts: rowsOf(pushBroadcasts),
      discountCodes: rowsOf(discountCodes),
      influencers: rowsOf(influencers),
      unsubscribes: int(rowsOf(unsubscribes)[0]?.n),
    }));
  } catch (err) {
    req.log?.error({ err }, "Failed to load marketing analytics");
    res.status(500).json({ error: "Failed to load marketing analytics" });
  }
});

// ─── GET /production ──────────────────────────────────────────────────────────
// Pipeline state, not a period window: an order placed months ago and still
// being sewn is an active job today.

router.get("/production", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    const rows = await db.execute(sql`
      SELECT so.manufacturer_id, m.business_name AS manufacturer_name, so.order_type, so.status,
             so.quantity, so.price_cents, so.created_at, so.delivered_at, so.revision
      FROM sample_orders so
      LEFT JOIN manufacturers m ON m.id = so.manufacturer_id
      WHERE so.seller_id = ${sellerId}
        AND so.status NOT IN ('pending_payment', 'cancelled')
        AND so.payment_review_state <> 'reversed'
      ORDER BY so.created_at DESC
      LIMIT 500
    `);
    res.json(buildProductionResponse(rowsOf(rows)));
  } catch (err) {
    req.log?.error({ err }, "Failed to load production analytics");
    res.status(500).json({ error: "Failed to load production analytics" });
  }
});

// ─── GET /profit ──────────────────────────────────────────────────────────────

router.get("/profit", async (req, res) => {
  const sellerId = sellerOf(req);
  const { period, start, end } = resolveAnalyticsPeriod(req.query.period);
  const window = sql`o.created_at >= ${ts(start)} AND o.created_at < ${ts(end)}`;
  const sums = sql`
    coalesce(sum(o.total_cents), 0)::bigint AS gross_cents,
    coalesce(sum(o.refunded_cents), 0)::bigint AS refunded_cents,
    coalesce(sum(o.tax_cents), 0)::bigint AS tax_cents,
    coalesce(sum(o.platform_fee_cents - o.platform_fee_refunded_cents), 0)::bigint AS platform_fee_cents,
    coalesce(sum(o.processing_fee_charged_cents), 0)::bigint AS processing_fee_cents`;
  try {
    const [totals, daily, manufacturer] = await Promise.all([
      db.execute(sql`
        SELECT ${sums},
               coalesce(sum(o.shipping_cents), 0)::bigint AS shipping_cents,
               coalesce(sum(o.discount_amount_cents), 0)::bigint AS discount_cents,
               count(*)::int AS order_count
        FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${window}
      `),
      db.execute(sql`
        SELECT date_trunc('day', o.created_at) AS day, ${sums}
        FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${window}
        GROUP BY 1
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT coalesce(sum(price_cents), 0)::bigint AS cost_cents
        FROM sample_orders
        WHERE seller_id = ${sellerId}
          AND status NOT IN ('pending_payment', 'cancelled')
          AND payment_review_state <> 'reversed'
          AND created_at >= ${ts(start)} AND created_at < ${ts(end)}
      `),
    ]);
    res.json(buildProfitResponse({
      period,
      totals: rowsOf(totals)[0],
      daily: rowsOf(daily),
      manufacturerCostCents: int(rowsOf(manufacturer)[0]?.cost_cents),
    }));
  } catch (err) {
    req.log?.error({ err }, "Failed to load profit analytics");
    res.status(500).json({ error: "Failed to load profit analytics" });
  }
});

// ─── GET /payouts ─────────────────────────────────────────────────────────────
// Same read gate as /api/finance/*: owner, manager or a payouts role.

router.get("/payouts", requirePayoutsRead(), async (req, res) => {
  const sellerId = sellerOf(req);
  const { start, end } = resolveAnalyticsPeriod(req.query.period);
  try {
    const [ledger, releases, orderImpact, account] = await Promise.all([
      db.execute(sql`
        SELECT
          coalesce(sum(amount_cents) FILTER (WHERE account = 'seller_held'), 0)::bigint AS held_cents,
          coalesce(sum(amount_cents) FILTER (WHERE account = 'seller_paid_out'), 0)::bigint AS paid_out_cents
        FROM ledger_postings
        WHERE party_id = ${sellerId} AND account IN ('seller_held', 'seller_paid_out')
      `),
      db.execute(sql`
        SELECT
          coalesce(sum(amount_cents) FILTER (WHERE state IN ('pending', 'transferring', 'failed')), 0)::bigint AS releasing_cents,
          coalesce(sum(bulk_share_cents) FILTER (WHERE created_at >= ${tstz(start)} AND created_at < ${tstz(end)}), 0)::bigint AS bulk_share_cents,
          coalesce(sum(label_cents) FILTER (WHERE created_at >= ${tstz(start)} AND created_at < ${tstz(end)}), 0)::bigint AS label_cents
        FROM order_releases
        WHERE seller_id = ${sellerId}
      `),
      db.execute(sql`
        SELECT
          coalesce(sum(GREATEST(o.gross_charged_cents - o.refunded_cents, 0))
            FILTER (WHERE o.dispute_paused_at IS NOT NULL AND coalesce(o.funds_state, '') <> 'refunded'), 0)::bigint AS dispute_hold_cents,
          coalesce(sum(o.refunded_cents)
            FILTER (WHERE o.created_at >= ${ts(start)} AND o.created_at < ${ts(end)}), 0)::bigint AS refunded_cents
        FROM orders o
        WHERE o.owner_id = ${sellerId}
      `),
      db.execute(sql`SELECT stripe_account_id FROM users WHERE clerk_id = ${sellerId} LIMIT 1`),
    ]);

    const accountId = (rowsOf(account)[0]?.stripe_account_id as string | null | undefined) ?? null;
    let live: Parameters<typeof buildPayoutResponse>[0]["stripe"] = null;
    let stripeError = false;
    if (stripe && accountId) {
      try {
        const [balance, reservations, payoutPage] = await Promise.all([
          stripe.balance.retrieve({}, { stripeAccount: accountId }),
          db.execute(sql`
            SELECT coalesce(sum(amount_cents), 0)::int AS reserved FROM order_fund_reservations
            WHERE owner_id = ${sellerId} AND status = 'reserved'
          `),
          stripe.payouts.list({ limit: 100 }, { stripeAccount: accountId }),
        ]);
        const usd = (list: Array<{ currency: string; amount: number }>) =>
          list.find((entry) => entry.currency === "usd")?.amount ?? 0;
        const payouts = payoutPage.data.filter((p) => p.currency === "usd");
        const next = payouts
          .filter((p) => p.status === "pending" || p.status === "in_transit")
          .sort((a, b) => a.arrival_date - b.arrival_date)[0];
        live = {
          availableCents: cashOutableAmount(usd(balance.available), int(rowsOf(reservations)[0]?.reserved)),
          pendingCents: usd(balance.pending),
          paidOutCents: payouts.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amount, 0),
          nextPayout: next ? { amountCents: next.amount, arrivalDate: new Date(next.arrival_date * 1000).toISOString() } : null,
          history: payouts.slice(0, 20).map((p) => ({
            id: p.id,
            amountCents: p.amount,
            status: p.status,
            arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
            createdAt: new Date(p.created * 1000).toISOString(),
          })),
        };
      } catch (err) {
        // Ledger figures still render; live balance shows as zero.
        stripeError = true;
        req.log?.warn({ err }, "Stripe balance unavailable for payout analytics");
      }
    }

    res.json(buildPayoutResponse({
      ledger: rowsOf(ledger)[0],
      releases: rowsOf(releases)[0],
      orderImpact: rowsOf(orderImpact)[0],
      stripe: live,
      connected: Boolean(accountId),
      stripeError,
    }));
  } catch (err) {
    req.log?.error({ err }, "Failed to load payout analytics");
    res.status(500).json({ error: "Failed to load payout analytics" });
  }
});

// ─── GET /store ───────────────────────────────────────────────────────────────

router.get("/store", async (req, res) => {
  const sellerId = sellerOf(req);
  const { period, start, end } = resolveAnalyticsPeriod(req.query.period);
  const window = (col: string) => sql`${sql.raw(col)} >= ${ts(start)} AND ${sql.raw(col)} < ${ts(end)}`;
  try {
    const [visitors, visits, sources, daily, addToCart, checkoutStarts, orders, linkClicks] = await Promise.all([
      // storefront_visits: one row per signed-in visitor per seller per day.
      db.execute(sql`
        SELECT count(*)::int AS visitor_days,
               count(DISTINCT visitor_id)::int AS unique_visitors,
               (SELECT count(*)::int FROM (
                  SELECT visitor_id FROM storefront_visits
                  WHERE seller_id = ${sellerId} AND ${window("created_at")}
                  GROUP BY visitor_id HAVING count(*) > 1) r) AS returning_visitors
        FROM storefront_visits
        WHERE seller_id = ${sellerId} AND ${window("created_at")}
      `),
      // store_visits: every visit, signed-out buyers included, with source.
      db.execute(sql`
        SELECT count(*)::int AS sessions,
               count(product_id)::int AS product_views,
               count(device)::int AS device_known,
               count(*) FILTER (WHERE device IN ('ios', 'android'))::int AS mobile
        FROM store_visits
        WHERE seller_id = ${sellerId} AND ${window("created_at")}
      `),
      db.execute(sql`
        SELECT source, count(*)::int AS visits, count(product_id)::int AS product_views
        FROM store_visits
        WHERE seller_id = ${sellerId} AND ${window("created_at")}
        GROUP BY source
      `),
      db.execute(sql`
        SELECT date_trunc('day', created_at) AS day, count(*)::int AS visitors
        FROM storefront_visits
        WHERE seller_id = ${sellerId} AND ${window("created_at")}
        GROUP BY 1
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT count(*)::int AS n FROM seller_product_events
        WHERE seller_id = ${sellerId} AND event_type = 'add_to_cart' AND ${window("created_at")}
      `),
      db.execute(sql`
        SELECT count(*)::int AS n FROM checkout_sessions
        WHERE seller_id = ${sellerId} AND ${window("created_at")}
      `),
      db.execute(sql`
        SELECT count(*)::int AS n FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${window("o.created_at")}
      `),
      db.execute(sql`
        SELECT coalesce(referrer_host, 'Direct') AS label, count(*)::int AS clicks
        FROM link_clicks
        WHERE seller_id = ${sellerId} AND ${window("created_at")}
        GROUP BY 1
        ORDER BY clicks DESC
        LIMIT 5
      `),
    ]);
    res.json(buildStoreResponse({
      period,
      visitors: rowsOf(visitors)[0],
      visits: rowsOf(visits)[0],
      sources: rowsOf(sources),
      daily: rowsOf(daily),
      addToCart: int(rowsOf(addToCart)[0]?.n),
      checkoutStarts: int(rowsOf(checkoutStarts)[0]?.n),
      orders: int(rowsOf(orders)[0]?.n),
      linkClicks: rowsOf(linkClicks),
    }));
  } catch (err) {
    req.log?.error({ err }, "Failed to load store analytics");
    res.status(500).json({ error: "Failed to load store analytics" });
  }
});

export default router;
