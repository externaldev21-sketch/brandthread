/** Read models for the seller dashboard and creator screens (all integer cents). */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type AffiliateStats = {
  clicks: number;
  orders: number;
  revenueCents: number;
  /** Net commission earned (accrued minus reversed). */
  earnedCents: number;
  /** Earned, still inside the return window / not yet delivered. */
  pendingCents: number;
  /** Earned, past the hold period, waiting for the next payout. */
  payableCents: number;
  paidCents: number;
};

const n = (v: unknown) => Number(v ?? 0);

const STATS_SELECT = sql`
  (SELECT COUNT(*) FROM affiliate_clicks k WHERE k.affiliate_id = a.id) AS clicks,
  (SELECT COUNT(*) FROM affiliate_commissions c WHERE c.affiliate_id = a.id AND c.status <> 'reversed') AS orders,
  (SELECT COALESCE(SUM(c.base_cents), 0) FROM affiliate_commissions c WHERE c.affiliate_id = a.id AND c.status <> 'reversed') AS revenue,
  (SELECT COALESCE(SUM(c.amount_cents - c.reversed_cents), 0) FROM affiliate_commissions c WHERE c.affiliate_id = a.id) AS earned,
  (SELECT COALESCE(SUM(GREATEST(c.amount_cents - c.reversed_cents - c.paid_cents, 0)), 0) FROM affiliate_commissions c WHERE c.affiliate_id = a.id AND c.status = 'pending') AS pending,
  (SELECT COALESCE(SUM(GREATEST(c.amount_cents - c.reversed_cents - c.paid_cents, 0)), 0) FROM affiliate_commissions c WHERE c.affiliate_id = a.id AND c.status = 'payable') AS payable,
  (SELECT COALESCE(SUM(c.paid_cents), 0) FROM affiliate_commissions c WHERE c.affiliate_id = a.id) AS paid
`;

function toStats(r: any): AffiliateStats {
  return {
    clicks: n(r.clicks), orders: n(r.orders), revenueCents: n(r.revenue), earnedCents: n(r.earned),
    pendingCents: n(r.pending), payableCents: n(r.payable), paidCents: n(r.paid),
  };
}

export function sumStats(list: AffiliateStats[]): AffiliateStats {
  return list.reduce<AffiliateStats>((t, s) => ({
    clicks: t.clicks + s.clicks, orders: t.orders + s.orders, revenueCents: t.revenueCents + s.revenueCents,
    earnedCents: t.earnedCents + s.earnedCents, pendingCents: t.pendingCents + s.pendingCents,
    payableCents: t.payableCents + s.payableCents, paidCents: t.paidCents + s.paidCents,
  }), { clicks: 0, orders: 0, revenueCents: 0, earnedCents: 0, pendingCents: 0, payableCents: 0, paidCents: 0 });
}

const rowsOf = (res: unknown) => ((res as { rows?: any[] }).rows ?? []);

export async function sellerCreatorRows(sellerId: string) {
  const res = await db.execute(sql`
    SELECT a.id, a.creator_id, a.status, a.origin, a.code, a.commission_bps_override, a.approved_at, a.created_at,
           u.username, u.display_name, u.name, u.profile_image_url, u.avatar_url,
           ${STATS_SELECT}
    FROM affiliate_creators a LEFT JOIN users u ON u.clerk_id = a.creator_id
    WHERE a.seller_id = ${sellerId} AND a.status <> 'declined'
    ORDER BY a.created_at DESC
  `);
  return rowsOf(res).map((r) => ({
    id: r.id as string,
    creatorId: r.creator_id as string,
    status: r.status as string,
    origin: r.origin as string,
    code: r.code as string,
    commissionBpsOverride: r.commission_bps_override == null ? null : Number(r.commission_bps_override),
    approvedAt: r.approved_at,
    createdAt: r.created_at,
    username: r.username ?? null,
    displayName: r.display_name || r.name || null,
    avatarUrl: r.profile_image_url || r.avatar_url || null,
    stats: toStats(r),
  }));
}

export async function creatorBrandRows(creatorId: string) {
  const res = await db.execute(sql`
    SELECT a.id, a.seller_id, a.status, a.code, a.commission_bps_override, a.created_at,
           s.username AS seller_username, s.brand_name, s.display_name AS seller_display, s.name AS seller_name,
           s.profile_image_url AS seller_image,
           p.enabled, p.default_commission_bps, p.buyer_discount_bps, p.window_days, p.hold_days, p.min_payout_cents,
           ${STATS_SELECT}
    FROM affiliate_creators a
    JOIN users s ON s.clerk_id = a.seller_id
    LEFT JOIN affiliate_programs p ON p.seller_id = a.seller_id
    WHERE a.creator_id = ${creatorId} AND a.status NOT IN ('removed', 'declined')
    ORDER BY a.created_at DESC
  `);
  return rowsOf(res).map((r) => ({
    id: r.id as string,
    sellerId: r.seller_id as string,
    status: r.status as string,
    code: r.code as string,
    brandName: (r.brand_name || r.seller_display || r.seller_name || "Brand") as string,
    brandUsername: (r.seller_username ?? null) as string | null,
    brandImageUrl: (r.seller_image ?? null) as string | null,
    programEnabled: Boolean(r.enabled),
    commissionBps: r.commission_bps_override != null ? Number(r.commission_bps_override) : n(r.default_commission_bps ?? 1000),
    buyerDiscountBps: n(r.buyer_discount_bps),
    windowDays: n(r.window_days ?? 30),
    holdDays: n(r.hold_days ?? 30),
    minPayoutCents: n(r.min_payout_cents ?? 2500),
    stats: toStats(r),
  }));
}

export async function creatorPayoutRows(creatorId: string, limit = 50) {
  const res = await db.execute(sql`
    SELECT po.id, po.seller_id, po.amount_cents, po.state, po.failure_code, po.paid_at, po.created_at,
           s.brand_name, s.display_name, s.name
    FROM affiliate_payouts po LEFT JOIN users s ON s.clerk_id = po.seller_id
    WHERE po.creator_id = ${creatorId} AND po.state <> 'cancelled'
    ORDER BY po.created_at DESC LIMIT ${limit}
  `);
  return rowsOf(res).map((r) => ({
    id: r.id as string,
    sellerId: r.seller_id as string,
    brandName: (r.brand_name || r.display_name || r.name || "Brand") as string,
    amountCents: n(r.amount_cents),
    state: r.state as string,
    failureCode: (r.failure_code ?? null) as string | null,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  }));
}

export async function sellerPayoutRows(sellerId: string, limit = 50) {
  const res = await db.execute(sql`
    SELECT po.id, po.creator_id, po.amount_cents, po.state, po.paid_at, po.created_at, u.username, u.display_name, u.name
    FROM affiliate_payouts po LEFT JOIN users u ON u.clerk_id = po.creator_id
    WHERE po.seller_id = ${sellerId} AND po.state <> 'cancelled'
    ORDER BY po.created_at DESC LIMIT ${limit}
  `);
  return rowsOf(res).map((r) => ({
    id: r.id as string,
    creatorId: r.creator_id as string,
    creatorName: (r.display_name || r.name || r.username || "Creator") as string,
    amountCents: n(r.amount_cents),
    state: r.state as string,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  }));
}
