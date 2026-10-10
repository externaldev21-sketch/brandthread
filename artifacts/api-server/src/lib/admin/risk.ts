/**
 * Admin risk queue (BT-470). Three lists, each row actionable from the admin
 * Risk page (suspend the user, hold their payouts):
 *
 *  orders       paid orders in the last RISK_WINDOW_DAYS with a Stripe Radar
 *               risk level of elevated or highest (lib/risk/orderRisk.ts).
 *  newSellers   sellers whose account is younger than NEW_SELLER_DAYS and
 *               whose GMV in that time is at least FAST_GMV_CENTS, or who
 *               took FAST_ORDER_COUNT orders — fast money on a new account is
 *               the classic ship-nothing pattern.
 *  threadCash   devices shared by SHARED_DEVICE_MIN_ACCOUNTS or more Thread
 *               Cash accounts (check-in farming), and accounts forwarding
 *               Thread Cash they received within SEND_CHAIN_WINDOW_MINUTES
 *               (rapid send chains).
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const RISK_WINDOW_DAYS = 30;
export const NEW_SELLER_DAYS = 30;
export const FAST_GMV_CENTS = 100_000; // $1,000
export const FAST_ORDER_COUNT = 20;
export const SHARED_DEVICE_MIN_ACCOUNTS = 3;
export const SEND_CHAIN_WINDOW_MINUTES = 60;

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? []);
const n = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const nameOf = (r: Row, p = "") =>
  (r[`${p}brand_name`] || r[`${p}display_name`] || r[`${p}name`] || (r[`${p}username`] ? `@${r[`${p}username`]}` : null) || "Unknown") as string;

export async function riskQueue(now = new Date()) {
  const since = new Date(now.getTime() - RISK_WINDOW_DAYS * 86_400_000);
  const newSince = new Date(now.getTime() - NEW_SELLER_DAYS * 86_400_000);
  const [orderRows, sellerRows, deviceRows, chainRows] = await Promise.all([
    db.execute(sql`
      SELECT o.id, o.order_number, o.total_cents, o.risk_level, o.risk_score, o.risk_flags, o.risk_reviewed, o.status, o.paid_at,
             o.owner_id, s.brand_name, s.display_name, s.name, s.username, s.suspended_at,
             o.buyer_id, b.display_name AS b_display_name, b.name AS b_name, b.username AS b_username, b.brand_name AS b_brand_name, o.guest_email,
             pc.state AS payout_state
      FROM orders o
      LEFT JOIN users s ON s.clerk_id = o.owner_id
      LEFT JOIN users b ON b.clerk_id = o.buyer_id
      LEFT JOIN payout_controls pc ON pc.party_type = 'seller' AND pc.party_id = o.owner_id
      WHERE o.paid_at >= ${since} AND o.risk_level IN ('elevated', 'highest')
      ORDER BY (o.risk_level = 'highest') DESC, o.risk_score DESC NULLS LAST, o.paid_at DESC
      LIMIT 50`).then(rowsOf),
    db.execute(sql`
      SELECT u.clerk_id, u.brand_name, u.display_name, u.name, u.username, u.created_at, u.suspended_at,
             count(o.id) AS orders, COALESCE(sum(o.total_cents), 0) AS gmv,
             count(o.id) FILTER (WHERE o.risk_level IN ('elevated', 'highest')) AS risky_orders,
             (SELECT count(*) FROM disputes d WHERE d.seller_id = u.clerk_id) AS disputes,
             pc.state AS payout_state
      FROM users u
      JOIN orders o ON o.owner_id = u.clerk_id AND o.paid_at IS NOT NULL
      LEFT JOIN payout_controls pc ON pc.party_type = 'seller' AND pc.party_id = u.clerk_id
      WHERE u.created_at >= ${newSince} AND u.deleted_at IS NULL
      GROUP BY u.clerk_id, u.brand_name, u.display_name, u.name, u.username, u.created_at, u.suspended_at, pc.state
      HAVING COALESCE(sum(o.total_cents), 0) >= ${FAST_GMV_CENTS} OR count(o.id) >= ${FAST_ORDER_COUNT}
      ORDER BY gmv DESC LIMIT 50`).then(rowsOf),
    db.execute(sql`
      SELECT s.last_device_id AS device_id, count(*) AS accounts,
             array_agg(s.buyer_id ORDER BY s.buyer_id) AS buyer_ids,
             (SELECT COALESCE(sum(e.amount_cents), 0) FROM thread_cash_entries e
               WHERE e.buyer_id = ANY(array_agg(s.buyer_id)) AND e.amount_cents > 0
                 AND e.source IN ('daily_checkin', 'streak_bonus', 'referral')) AS earned
      FROM thread_cash_streaks s
      WHERE s.last_device_id IS NOT NULL
      GROUP BY s.last_device_id
      HAVING count(*) >= ${SHARED_DEVICE_MIN_ACCOUNTS}
      ORDER BY count(*) DESC LIMIT 25`).then(rowsOf),
    db.execute(sql`
      SELECT fwd.sender_id AS middle_id, count(*) AS hops, COALESCE(sum(fwd.amount_cents), 0) AS forwarded,
             max(fwd.created_at) AS last_at, u.display_name, u.name, u.username, u.brand_name, u.suspended_at
      FROM thread_cash_transfers inbound
      JOIN thread_cash_transfers fwd ON fwd.sender_id = inbound.recipient_id
        AND fwd.created_at >= COALESCE(inbound.claimed_at, inbound.created_at)
        AND fwd.created_at <= COALESCE(inbound.claimed_at, inbound.created_at) + make_interval(mins => ${SEND_CHAIN_WINDOW_MINUTES})
      LEFT JOIN users u ON u.clerk_id = fwd.sender_id
      WHERE inbound.created_at >= ${since} AND inbound.status IN ('claimed', 'pending') AND fwd.status IN ('claimed', 'pending')
      GROUP BY fwd.sender_id, u.display_name, u.name, u.username, u.brand_name, u.suspended_at
      ORDER BY hops DESC LIMIT 25`).then(rowsOf),
  ]);

  // Names for the accounts behind each shared device.
  const deviceIds = [...new Set(deviceRows.flatMap((d) => (d.buyer_ids as string[]) ?? []))];
  const people = deviceIds.length
    ? rowsOf(await db.execute(sql`SELECT clerk_id, display_name, name, username, brand_name, suspended_at FROM users
        WHERE clerk_id IN (${sql.join(deviceIds.map((id) => sql`${id}`), sql`, `)})`))
    : [];
  const personById = new Map(people.map((p) => [String(p.clerk_id), p]));

  return {
    thresholds: { RISK_WINDOW_DAYS, NEW_SELLER_DAYS, FAST_GMV_CENTS, FAST_ORDER_COUNT, SHARED_DEVICE_MIN_ACCOUNTS, SEND_CHAIN_WINDOW_MINUTES },
    orders: orderRows.map((o) => ({
      id: String(o.id),
      orderNumber: String(o.order_number),
      totalCents: n(o.total_cents),
      riskLevel: String(o.risk_level),
      riskScore: o.risk_score == null ? null : n(o.risk_score),
      riskFlags: (o.risk_flags as Array<{ code: string; label: string; severity: string }>) ?? [],
      reviewed: o.risk_reviewed === true,
      status: String(o.status),
      paidAt: iso(o.paid_at),
      seller: { clerkId: String(o.owner_id), name: nameOf(o), suspended: o.suspended_at != null, payoutState: (o.payout_state as string | null) ?? null },
      buyer: { clerkId: (o.buyer_id as string | null) ?? null, name: o.buyer_id ? nameOf(o, "b_") : ((o.guest_email as string | null) ?? "Guest") },
    })),
    newSellers: sellerRows.map((s) => ({
      clerkId: String(s.clerk_id),
      name: nameOf(s),
      createdAt: iso(s.created_at),
      orders: n(s.orders),
      gmvCents: n(s.gmv),
      riskyOrders: n(s.risky_orders),
      disputes: n(s.disputes),
      suspended: s.suspended_at != null,
      payoutState: (s.payout_state as string | null) ?? null,
    })),
    threadCash: {
      sharedDevices: deviceRows.map((d) => ({
        deviceId: String(d.device_id),
        accounts: n(d.accounts),
        earnedCents: n(d.earned),
        people: ((d.buyer_ids as string[]) ?? []).slice(0, 10).map((id) => {
          const p = personById.get(id);
          return { clerkId: id, name: p ? nameOf(p) : "Unknown", suspended: p?.suspended_at != null };
        }),
      })),
      sendChains: chainRows.map((c) => ({
        clerkId: String(c.middle_id),
        name: nameOf(c),
        hops: n(c.hops),
        forwardedCents: n(c.forwarded),
        lastAt: iso(c.last_at),
        suspended: c.suspended_at != null,
      })),
    },
  };
}
