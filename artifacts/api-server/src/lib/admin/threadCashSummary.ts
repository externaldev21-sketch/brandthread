/**
 * Admin Thread Cash dashboard (BT-448). Everything is derived from the
 * append-only thread_cash_entries ledger:
 *   issued       platform-funded credit: rewards (check-in, streak, referral)
 *                plus positive admin adjustments
 *   redeemed     spent toward purchases, net of cancelled reservations and
 *                credit returned by refunds
 *   expired      lapsed credit (source 'expiry')
 *   outstanding  SUM(amount_cents) over every holder = what Brandthread owes
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { THREAD_CASH_REWARD_SOURCES } from "./revenue";
import { threadCashPauseState } from "../threadCash/killSwitch";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? []);
const n = (v: unknown) => Number(v ?? 0) || 0;

const REWARDS = sql.join(THREAD_CASH_REWARD_SOURCES.map((s) => sql`${s}`), sql`, `);
const ISSUED = sql`(amount_cents > 0 AND (source IN (${REWARDS}) OR source = 'admin_adjustment'))`;
const REDEEMED = sql`source IN ('redemption', 'redemption_cancelled', 'refund_credit')`;

export async function threadCashSummary(days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [[totals], series, top, pause] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(sum(amount_cents), 0) AS outstanding,
        COALESCE(sum(amount_cents) FILTER (WHERE ${ISSUED} AND created_at >= ${since}), 0) AS issued,
        COALESCE(-sum(amount_cents) FILTER (WHERE ${REDEEMED} AND created_at >= ${since}), 0) AS redeemed,
        COALESCE(-sum(amount_cents) FILTER (WHERE source = 'expiry' AND created_at >= ${since}), 0) AS expired,
        COALESCE(sum(amount_cents) FILTER (WHERE amount_cents > 0 AND source IN (${REWARDS}) AND created_at >= ${startOfDay}), 0) AS rewards_today,
        COALESCE(sum(amount_cents) FILTER (WHERE amount_cents > 0 AND source IN (${REWARDS}) AND created_at >= ${startOfMonth}), 0) AS rewards_month,
        count(DISTINCT buyer_id) FILTER (WHERE amount_cents > 0 AND source IN (${REWARDS}) AND created_at >= ${startOfDay}) AS earners_today
      FROM thread_cash_entries`).then(rowsOf),
    db.execute(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        COALESCE(sum(amount_cents) FILTER (WHERE ${ISSUED}), 0) AS issued,
        COALESCE(-sum(amount_cents) FILTER (WHERE ${REDEEMED}), 0) AS redeemed,
        COALESCE(-sum(amount_cents) FILTER (WHERE source = 'expiry'), 0) AS expired
      FROM thread_cash_entries WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`).then(rowsOf),
    db.execute(sql`
      SELECT e.buyer_id, COALESCE(sum(e.amount_cents), 0) AS earned, count(*) AS entries,
        u.name, u.display_name, u.username, u.email,
        (SELECT COALESCE(sum(b.amount_cents), 0) FROM thread_cash_entries b WHERE b.buyer_id = e.buyer_id) AS balance
      FROM thread_cash_entries e LEFT JOIN users u ON u.clerk_id = e.buyer_id
      WHERE e.amount_cents > 0 AND e.source IN (${REWARDS}) AND e.created_at >= ${since}
      GROUP BY e.buyer_id, u.name, u.display_name, u.username, u.email
      ORDER BY earned DESC LIMIT 10`).then(rowsOf),
    threadCashPauseState(),
  ]);
  return {
    days,
    outstandingCents: n(totals?.outstanding),
    issuedCents: n(totals?.issued),
    redeemedCents: n(totals?.redeemed),
    expiredCents: n(totals?.expired),
    rewardsTodayCents: n(totals?.rewards_today),
    rewardsMonthCents: n(totals?.rewards_month),
    earnersToday: n(totals?.earners_today),
    series: series.map((s) => ({ day: String(s.day), issuedCents: n(s.issued), redeemedCents: n(s.redeemed), expiredCents: n(s.expired) })),
    topEarners: top.map((t) => ({
      clerkId: String(t.buyer_id),
      name: (t.display_name || t.name || (t.username ? `@${t.username}` : null) || "Unknown") as string,
      email: (t.email ?? null) as string | null,
      earnedCents: n(t.earned),
      entries: n(t.entries),
      balanceCents: n(t.balance),
    })),
    pause,
  };
}
