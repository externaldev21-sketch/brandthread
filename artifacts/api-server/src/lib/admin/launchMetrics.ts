/**
 * Internal marketplace numbers for the admin Metrics page and the Monday email.
 * Read-only SQL over orders / users / disputes / products / posts; nothing here
 * writes or moves money.
 *
 * Definitions (kept in one place so the page and the email always agree):
 * - A sale is an order with paid_at set and status <> 'cancelled'.
 * - GMV = sum(total_cents) of sales. Fees = platform_fee_cents net of
 *   platform_fee_refunded_cents.
 * - A buyer is buyer_id, or the lower-cased guest email for guest checkout.
 *   A new buyer is one whose first-ever sale falls in the window.
 * - An active seller made at least one sale in the trailing 30 days.
 * - Test, system and App Review accounts are excluded everywhere.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";

import { INACTIVE_SELLER_DAYS, sellerRiskRates } from "./metricRules";

export { INACTIVE_SELLER_DAYS, SELLER_RISK_THRESHOLD, sellerRiskRates } from "./metricRules";
const DAY_MS = 86_400_000;

type Window = { from: Date; to: Date };
type Row = Record<string, unknown>;

async function rows<T extends Row>(query: SQL): Promise<T[]> {
  const res = await db.execute(query);
  return ((res as unknown as { rows?: T[] }).rows ?? (res as unknown as T[])) as T[];
}
const n = (v: unknown) => Number(v ?? 0) || 0;

/** Sellers/buyers to leave out of every number: system, App Review and deleted accounts. */
const EXCLUDED_USERS = sql`(SELECT clerk_id FROM users WHERE is_system_account OR is_review_account OR deleted_at IS NOT NULL)`;
const SALE = sql`o.paid_at IS NOT NULL AND o.status <> 'cancelled' AND o.owner_id NOT IN ${EXCLUDED_USERS}`;
const BUYER_KEY = sql`COALESCE(o.buyer_id, 'guest:' || lower(o.guest_email))`;

export type SalesTotals = {
  gmvCents: number; feesCents: number; orders: number; newBuyers: number; signups: number;
};

export async function salesTotals(w: Window): Promise<SalesTotals> {
  const [sales] = await rows<Row>(sql`
    SELECT COALESCE(sum(o.total_cents), 0) AS gmv,
           COALESCE(sum(o.platform_fee_cents - o.platform_fee_refunded_cents), 0) AS fees,
           count(*) AS orders
    FROM orders o
    WHERE ${SALE} AND o.paid_at >= ${w.from} AND o.paid_at < ${w.to}`);
  const [buyers] = await rows<Row>(sql`
    SELECT count(*) AS n FROM (
      SELECT ${BUYER_KEY} AS buyer, min(o.paid_at) AS first_paid
      FROM orders o
      WHERE ${SALE} AND (o.buyer_id IS NOT NULL OR o.guest_email IS NOT NULL)
        AND (o.buyer_id IS NULL OR o.buyer_id NOT IN ${EXCLUDED_USERS})
      GROUP BY 1
    ) b WHERE b.first_paid >= ${w.from} AND b.first_paid < ${w.to}`);
  const [joined] = await rows<Row>(sql`
    SELECT count(*) AS n FROM users
    WHERE created_at >= ${w.from} AND created_at < ${w.to}
      AND deleted_at IS NULL AND NOT is_system_account AND NOT is_review_account`);
  return {
    gmvCents: n(sales?.gmv), feesCents: n(sales?.fees), orders: n(sales?.orders),
    newBuyers: n(buyers?.n), signups: n(joined?.n),
  };
}

export async function activeSellerCount(at: Date, days = 30): Promise<number> {
  const [r] = await rows<Row>(sql`
    SELECT count(DISTINCT o.owner_id) AS n FROM orders o
    WHERE ${SALE} AND o.paid_at >= ${new Date(at.getTime() - days * DAY_MS)} AND o.paid_at < ${at}`);
  return n(r?.n);
}

/** Today so far against the same stretch of yesterday. */
export async function todaySnapshot(windows: { today: Window; yesterdaySameTime: Window }) {
  const [today, yesterday, activeSellers, activeSellersYesterday] = await Promise.all([
    salesTotals(windows.today),
    salesTotals(windows.yesterdaySameTime),
    activeSellerCount(windows.today.to),
    activeSellerCount(windows.yesterdaySameTime.to),
  ]);
  return { today: { ...today, activeSellers }, yesterday: { ...yesterday, activeSellers: activeSellersYesterday } };
}

export type CohortRow = {
  month: string; buyers: number; repeatBuyers: number; repeatRate: number | null; maturing: boolean;
};

/**
 * Monthly first-purchase cohorts: of the buyers whose first sale fell in a
 * month, how many bought again within 30 days of that first sale. A cohort is
 * "maturing" while some of its buyers haven't had their full 30 days yet; its
 * rate only counts buyers whose 30 days are over.
 */
export async function repeatBuyerCohorts(now: Date, months = 6): Promise<CohortRow[]> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const result = await rows<Row>(sql`
    WITH sales AS (
      SELECT ${BUYER_KEY} AS buyer, o.paid_at FROM orders o
      WHERE ${SALE} AND (o.buyer_id IS NOT NULL OR o.guest_email IS NOT NULL)
        AND (o.buyer_id IS NULL OR o.buyer_id NOT IN ${EXCLUDED_USERS})
    ), firsts AS (
      SELECT buyer, min(paid_at) AS first_paid FROM sales GROUP BY buyer
    ), flagged AS (
      SELECT f.buyer, f.first_paid,
             (f.first_paid + interval '30 days') <= ${now} AS mature,
             EXISTS (SELECT 1 FROM sales s WHERE s.buyer = f.buyer
                     AND s.paid_at > f.first_paid AND s.paid_at <= f.first_paid + interval '30 days') AS repeated
      FROM firsts f WHERE f.first_paid >= ${since} AND f.first_paid < ${now}
    )
    SELECT to_char(date_trunc('month', first_paid), 'YYYY-MM') AS month,
           count(*) AS buyers,
           count(*) FILTER (WHERE mature) AS mature_buyers,
           count(*) FILTER (WHERE repeated) AS repeat_buyers,
           count(*) FILTER (WHERE repeated AND mature) AS mature_repeat
    FROM flagged GROUP BY 1 ORDER BY 1 DESC`);
  return result.map((r) => {
    const mature = n(r.mature_buyers);
    return {
      month: String(r.month),
      buyers: n(r.buyers),
      repeatBuyers: n(r.repeat_buyers),
      repeatRate: mature > 0 ? n(r.mature_repeat) / mature : null,
      maturing: mature < n(r.buyers),
    };
  });
}

export async function topSellers(w: Window, limit = 10) {
  const result = await rows<Row>(sql`
    SELECT o.owner_id AS clerk_id,
           COALESCE(NULLIF(u.brand_name, ''), NULLIF(u.display_name, ''), u.name) AS name,
           u.username, count(*) AS orders, sum(o.total_cents) AS gmv,
           sum(o.platform_fee_cents - o.platform_fee_refunded_cents) AS fees
    FROM orders o LEFT JOIN users u ON u.clerk_id = o.owner_id
    WHERE ${SALE} AND o.paid_at >= ${w.from} AND o.paid_at < ${w.to}
    GROUP BY o.owner_id, u.brand_name, u.display_name, u.name, u.username
    ORDER BY gmv DESC, orders DESC LIMIT ${limit}`);
  return result.map((r) => ({
    clerkId: String(r.clerk_id), name: (r.name as string | null) ?? null, username: (r.username as string | null) ?? null,
    orders: n(r.orders), gmvCents: n(r.gmv), feesCents: n(r.fees),
  }));
}

export async function topProducts(w: Window, limit = 10) {
  const result = await rows<Row>(sql`
    SELECT p.id, p.name, p.owner_id,
           COALESCE(NULLIF(u.brand_name, ''), NULLIF(u.display_name, ''), u.name) AS seller,
           sum(oi.quantity) AS units, sum(oi.quantity * oi.price_cents) AS revenue, count(DISTINCT o.id) AS orders
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN product_variants v ON v.id = oi.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN users u ON u.clerk_id = p.owner_id
    WHERE ${SALE} AND o.paid_at >= ${w.from} AND o.paid_at < ${w.to}
    GROUP BY p.id, p.name, p.owner_id, u.brand_name, u.display_name, u.name
    ORDER BY revenue DESC, units DESC LIMIT ${limit}`);
  return result.map((r) => ({
    productId: String(r.id), name: String(r.name), seller: (r.seller as string | null) ?? null,
    units: n(r.units), revenueCents: n(r.revenue), orders: n(r.orders),
  }));
}

/**
 * Install → sign-up → first purchase.
 * - `installs`: devices first seen in the window (app_installs), how many of
 *   them signed in to an account, and how many of those accounts have made a
 *   purchase. Starts counting from the day install tracking shipped.
 * - `signups`: accounts created in the window and how many have made a
 *   purchase, so the lower half of the funnel works for older accounts too.
 */
export async function acquisitionFunnel(w: Window) {
  const [inst] = await rows<Row>(sql`
    SELECT count(*) AS installs,
           count(*) FILTER (WHERE i.clerk_id IS NOT NULL) AS signed_up,
           count(*) FILTER (WHERE i.clerk_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM orders o WHERE o.buyer_id = i.clerk_id AND ${SALE})) AS purchased
    FROM app_installs i
    WHERE i.first_seen_at >= ${w.from} AND i.first_seen_at < ${w.to}
      AND (i.clerk_id IS NULL OR i.clerk_id NOT IN ${EXCLUDED_USERS})`);
  const [acct] = await rows<Row>(sql`
    SELECT count(*) AS signups,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM orders o WHERE o.buyer_id = u.clerk_id AND ${SALE})) AS purchased
    FROM users u
    WHERE u.created_at >= ${w.from} AND u.created_at < ${w.to}
      AND u.deleted_at IS NULL AND NOT u.is_system_account AND NOT u.is_review_account`);
  return {
    installs: { installs: n(inst?.installs), signedUp: n(inst?.signed_up), purchased: n(inst?.purchased) },
    signups: { signups: n(acct?.signups), purchased: n(acct?.purchased) },
  };
}

export type SellerRisk = {
  clerkId: string; name: string | null; username: string | null;
  orders: number; refundedOrders: number; chargebacks: number;
  refundRate: number; chargebackRate: number; flagged: boolean;
};

/**
 * Per-seller refund and chargeback rate over sales paid in the window.
 * Refund rate = sales with any refund / sales. Chargeback rate = Stripe
 * disputes opened on those sales / sales. Flagged above 2% (either rate).
 * Only sellers with at least one refund or chargeback are returned.
 */
export async function sellerRefundChargebackRates(w: Window, limit = 100): Promise<SellerRisk[]> {
  const result = await rows<Row>(sql`
    SELECT o.owner_id AS clerk_id,
           COALESCE(NULLIF(u.brand_name, ''), NULLIF(u.display_name, ''), u.name) AS name, u.username,
           count(*) AS orders,
           count(*) FILTER (WHERE o.refunded_cents > 0) AS refunded,
           count(DISTINCT d.id) AS chargebacks
    FROM orders o
    LEFT JOIN users u ON u.clerk_id = o.owner_id
    LEFT JOIN disputes d ON d.order_id = o.id
    WHERE ${SALE} AND o.paid_at >= ${w.from} AND o.paid_at < ${w.to}
    GROUP BY o.owner_id, u.brand_name, u.display_name, u.name, u.username
    HAVING count(*) FILTER (WHERE o.refunded_cents > 0) > 0 OR count(DISTINCT d.id) > 0`);
  return result
    .map((r) => {
      const orders = n(r.orders), refundedOrders = n(r.refunded), chargebacks = n(r.chargebacks);
      return {
        clerkId: String(r.clerk_id), name: (r.name as string | null) ?? null, username: (r.username as string | null) ?? null,
        orders, refundedOrders, chargebacks, ...sellerRiskRates(orders, refundedOrders, chargebacks),
      };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged)
      || Math.max(b.refundRate, b.chargebackRate) - Math.max(a.refundRate, a.chargebackRate)
      || b.orders - a.orders)
    .slice(0, limit);
}

export type InactiveSeller = {
  clerkId: string; name: string | null; username: string | null; email: string | null;
  lastActiveAt: string; daysInactive: number; activeProducts: number;
};

/**
 * Sellers who have been active before but show nothing for 14+ days: no sale,
 * no product created or edited, no post, and no app open (push token check-in).
 * Sellers who never did anything are onboarding, not inactive, and are left
 * out (the activation nudges cover them).
 */
export async function inactiveSellers(now: Date, opts: { days?: number; limit?: number } = {}): Promise<InactiveSeller[]> {
  const days = opts.days ?? INACTIVE_SELLER_DAYS;
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const result = await rows<Row>(sql`
    WITH sellers AS (
      SELECT clerk_id, email, username,
             COALESCE(NULLIF(brand_name, ''), NULLIF(display_name, ''), name) AS name
      FROM users
      WHERE account_type IN ('seller', 'both') AND deleted_at IS NULL AND suspended_at IS NULL
        AND NOT is_system_account AND NOT is_review_account
    ), activity AS (
      SELECT s.clerk_id, GREATEST(
        (SELECT max(o.paid_at) FROM orders o WHERE o.owner_id = s.clerk_id AND o.paid_at IS NOT NULL),
        (SELECT max(p.updated_at) FROM products p WHERE p.owner_id = s.clerk_id),
        (SELECT max(po.created_at) FROM posts po WHERE po.user_id = s.clerk_id),
        (SELECT max(t.last_seen_at) FROM push_tokens t WHERE t.user_id = s.clerk_id)
      ) AS last_active
      FROM sellers s
    )
    SELECT s.clerk_id, s.name, s.username, s.email, a.last_active,
           (SELECT count(*) FROM products p WHERE p.owner_id = s.clerk_id AND p.status = 'active' AND p.deleted_at IS NULL) AS active_products
    FROM sellers s JOIN activity a ON a.clerk_id = s.clerk_id
    WHERE a.last_active IS NOT NULL AND a.last_active < ${cutoff}
    ORDER BY a.last_active DESC
    LIMIT ${opts.limit ?? 200}`);
  return result.map((r) => {
    const last = r.last_active instanceof Date ? r.last_active : new Date(String(r.last_active));
    return {
      clerkId: String(r.clerk_id), name: (r.name as string | null) ?? null, username: (r.username as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      lastActiveAt: last.toISOString(),
      daysInactive: Math.floor((now.getTime() - last.getTime()) / DAY_MS),
      activeProducts: n(r.active_products),
    };
  });
}
