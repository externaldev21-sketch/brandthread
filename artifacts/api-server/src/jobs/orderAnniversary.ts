/**
 * Order anniversary ("One year ago today") — 11:00–11:59 in the buyer's own
 * timezone (lib/userTimezone.ts), for an order paid exactly one year ago on
 * the buyer-local calendar (Feb 29 orders are remembered on Feb 28).
 *
 * Hourly. Only delivered orders that were never cancelled or refunded (fully
 * or partly), from a seller account that still exists, isn't suspended and
 * isn't blocked either way. The push opens the brand's profile.
 *
 * Claim-before-notify, two rows in retention_push_log:
 *   (user, 'order_anniversary_day', buyer-local YYYY-MM-DD)  at most one a day
 *   (user, 'order_anniversary', '<orderId>:<year>')          once per order-year
 * Only the run that inserts both sends; a failed send releases them.
 */
import { db, retentionPushLog } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { publishNotification } from "../routes/notifications-feed";
import { actorFieldsFromProfile } from "../lib/activityEvents";
import { profilesById } from "../lib/safety";
import { buildOrderAnniversaryCopy } from "../lib/retentionPushCopy";
import { isAnniversaryWindow, isOrderAnniversary, localDateKey, localParts, resolveUserTimezone } from "../lib/userTimezone";

const INTERVAL_MS = 60 * 60 * 1000;
export const ORDER_ANNIVERSARY_KIND = "order_anniversary";
export const ORDER_ANNIVERSARY_DAY_KIND = "order_anniversary_day";
const DAY_MS = 24 * 60 * 60 * 1000;

export type AnniversaryCandidate = {
  orderId: string;
  buyerId: string;
  sellerId: string;
  brandName: string;
  productName: string | null;
  paidAt: Date;
  userTimezone: string | null;
  streakTimezone: string | null;
  quietHoursTimezone: string | null;
};

/**
 * Coarse SQL window: paid between 368 and 363 days ago covers every timezone
 * offset and leap year; isOrderAnniversary() makes the exact local-date call.
 */
async function findCandidates(now: Date): Promise<AnniversaryCandidate[]> {
  const from = new Date(now.getTime() - 368 * DAY_MS).toISOString();
  const to = new Date(now.getTime() - 363 * DAY_MS).toISOString();
  const result = await db.execute(sql`
    SELECT o.id AS "orderId", o.buyer_id AS "buyerId", o.owner_id AS "sellerId",
           COALESCE(NULLIF(su.brand_name, ''), NULLIF(su.display_name, ''), su.name) AS "brandName",
           (SELECT oi.product_name FROM order_items oi
             WHERE oi.order_id = o.id AND oi.refunded_at IS NULL
             ORDER BY oi.price_cents DESC, oi.product_name LIMIT 1) AS "productName",
           (o.paid_at AT TIME ZONE 'UTC') AS "paidAt",
           u.timezone AS "userTimezone", s.timezone AS "streakTimezone",
           u.quiet_hours_timezone AS "quietHoursTimezone"
    FROM orders o
    JOIN users u ON u.clerk_id = o.buyer_id
    JOIN users su ON su.clerk_id = o.owner_id
    LEFT JOIN thread_cash_streaks s ON s.buyer_id = o.buyer_id
    WHERE o.paid_at IS NOT NULL
      AND (o.paid_at AT TIME ZONE 'UTC') >= ${from}::timestamptz
      AND (o.paid_at AT TIME ZONE 'UTC') <= ${to}::timestamptz
      AND (o.delivered_at IS NOT NULL OR o.status = 'delivered')
      AND o.status NOT IN ('cancelled', 'refunded', 'refund_pending')
      AND o.refunded_cents = 0 AND o.auto_refunded_at IS NULL
      AND o.funds_state IS DISTINCT FROM 'refunded'
      AND o.buyer_id <> o.owner_id
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL AND u.deletion_requested_at IS NULL
      AND u.push_enabled = true AND u.promo_push_opt_in = true
      AND EXISTS (SELECT 1 FROM push_tokens pt WHERE pt.user_id = o.buyer_id AND pt.is_active = true)
      AND su.account_type IN ('seller', 'both')
      AND su.deleted_at IS NULL AND su.suspended_at IS NULL AND su.deletion_requested_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = o.buyer_id AND b.blocked_id = o.owner_id)
           OR (b.blocker_id = o.owner_id AND b.blocked_id = o.buyer_id)
      )
    ORDER BY o.buyer_id, o.paid_at, o.id
  `);
  return (result.rows as AnniversaryCandidate[]).map((row) => ({ ...row, paidAt: new Date(row.paidAt) }));
}

/** At most one order per buyer: the earliest due one (rows arrive sorted). */
export function pickDueAnniversaries(candidates: AnniversaryCandidate[], now: Date): Array<AnniversaryCandidate & { timezone: string }> {
  const picked = new Map<string, AnniversaryCandidate & { timezone: string }>();
  for (const c of candidates) {
    if (picked.has(c.buyerId)) continue;
    const timezone = resolveUserTimezone(c);
    if (!isAnniversaryWindow(now, timezone) || !isOrderAnniversary(c.paidAt, now, timezone)) continue;
    picked.set(c.buyerId, { ...c, timezone });
  }
  return [...picked.values()];
}

async function claim(userId: string, dayKey: string, orderKey: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const day = await tx.insert(retentionPushLog)
      .values({ userId, kind: ORDER_ANNIVERSARY_DAY_KIND, periodKey: dayKey, sentAt: now })
      .onConflictDoNothing().returning({ id: retentionPushLog.id });
    if (day.length === 0) return false;
    const order = await tx.insert(retentionPushLog)
      .values({ userId, kind: ORDER_ANNIVERSARY_KIND, periodKey: orderKey, sentAt: now })
      .onConflictDoNothing().returning({ id: retentionPushLog.id });
    if (order.length === 0) {
      // This order's anniversary already went out; keep the day free for another.
      await tx.delete(retentionPushLog).where(eq(retentionPushLog.id, day[0]!.id));
      return false;
    }
    return true;
  });
}

async function release(userId: string, dayKey: string, orderKey: string): Promise<void> {
  await db.delete(retentionPushLog).where(and(
    eq(retentionPushLog.userId, userId),
    inArray(retentionPushLog.periodKey, [dayKey, orderKey]),
    inArray(retentionPushLog.kind, [ORDER_ANNIVERSARY_DAY_KIND, ORDER_ANNIVERSARY_KIND]),
  ));
}

export async function runOrderAnniversaries(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const due = pickDueAnniversaries(await findCandidates(now), now);
    if (due.length === 0) return { sent };
    const profiles = await profilesById(due.map((c) => c.sellerId));
    for (const c of due) {
      const profile = profiles.get(c.sellerId);
      if (!profile || profile.deleted || profile.suspended) continue;
      const dayKey = localDateKey(now, c.timezone);
      const orderKey = `${c.orderId}:${localParts(now, c.timezone).year}`;
      if (!(await claim(c.buyerId, dayKey, orderKey, now))) continue;
      const copy = buildOrderAnniversaryCopy({ productName: c.productName ?? "", brandName: c.brandName });
      try {
        await publishNotification({
          userId: c.buyerId,
          // A brand nudge, not an order update: Activity's social feed, push
          // gated by the buyer's New drops preference (the same switch as
          // "a brand you follow just listed …"), never Order updates.
          category: "social",
          pushCategory: "drop",
          type: "order_anniversary",
          title: copy.title,
          body: copy.body,
          ...actorFieldsFromProfile(profile),
          targetId: c.sellerId,
          targetType: "user",
          cta: "See what's new",
        });
        sent += 1;
      } catch (err) {
        await release(c.buyerId, dayKey, orderKey).catch(() => {});
        logger.warn({ err, userId: c.buyerId, orderId: c.orderId, job: "orderAnniversary" }, "Order anniversary push failed; will retry");
      }
    }
    if (sent > 0) logger.info({ job: "orderAnniversary", sent }, "Order anniversary pushes sent");
  } catch (err) {
    logger.error({ err, job: "orderAnniversary" }, "Order anniversary job failed");
  }
  return { sent };
}

export function startOrderAnniversaryJob(): void {
  setInterval(() => void runOrderAnniversaries(), INTERVAL_MS);
  logger.info({ job: "orderAnniversary", intervalMs: INTERVAL_MS }, "Order anniversary job scheduled");
}
