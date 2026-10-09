/**
 * Automatic non-delivery refunds and seller deadline warnings.
 *
 * runAutoRefundSweep refunds the items that were not delivered by their
 * deadline AND have a "not delivered" signal (autoRefundableItemSql):
 *   - never shipped: no tracking number, or no carrier scan at all (a label
 *     or a typed number the carrier never scanned is not a shipment);
 *   - the carrier says it failed: exception / returned to sender;
 *   - the buyer told us it never arrived (a "not received" return request).
 * A parcel the carrier scanned in transit that simply has no delivered scan
 * (unknown carrier, local delivery, guest buyer…) is NOT refunded by
 * default: the buyer has to say it didn't arrive.
 * Refunds go through the ONE refund path every buyer refund takes
 * (lib/money/refunds.ts), so it inherits its guarantees:
 *   - idempotent: the refund key is deterministic per (order, item set) and
 *     becomes a Stripe idempotency key, so a re-run, a retry after a crash
 *     or two servers running at once can never refund twice;
 *   - hold-until-delivered means the money is still on the platform's
 *     balance (PAYOUT_MODE=hold), so the refund costs the platform nothing;
 *   - full refund → order cancelled ("Refunded, not delivered in time");
 *     partial → only the undelivered items are refunded and marked.
 *
 * Skipped while: a chargeback is open (dispute_paused_at), a refund is in
 * flight, the order is cancelled/delivered, or a retry is backing off.
 * Before refunding, the carrier is asked one last time so a parcel that
 * arrived minutes ago is never refunded.
 */
import crypto from "node:crypto";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db, orderItems, orders } from "@workspace/db";
import { logger } from "../logger";
import { refundOrder, RefundError } from "../money/refunds";
import { reversePurchasePointsOnce } from "../../routes/loyalty";
import {
  AUTO_REFUND_REASON, autoRefundEnabled, deliveryWindowDays, dueWarningLevel, undeliveredRefundCents, windowDaysBetween,
} from "./policy";
import { finalizeIfAllDelivered, refreshOrderDeadline } from "./deliveryState";
import { notifyAutoRefunded, notifySellerDeadlineWarning } from "./notifications";

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

/** 10 min, 30 min, 2 h, 6 h, then every 6 h. */
const BACKOFF_MS = [10 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const STUCK_AFTER_ATTEMPTS = 3;
export function refundRetryDelayMs(attemptsSoFar: number): number {
  return BACKOFF_MS[Math.min(Math.max(attemptsSoFar, 1), BACKOFF_MS.length) - 1];
}

export function autoRefundKey(orderId: string, itemIds: string[]): string {
  const digest = crypto.createHash("sha1").update([...itemIds].sort().join(",")).digest("hex").slice(0, 16);
  return `auto-refund/${orderId}/${digest}`;
}

/** Carrier statuses that mean the parcel will not arrive. */
export const CARRIER_FAILURE_STATUSES = ["exception", "returned_to_sender"] as const;
/** Carrier statuses that only a physical scan produces (PRE_TRANSIT / "accepted" is just label data). */
export const CARRIER_SCAN_STATUSES = ["in_transit", "out_for_delivery", "delivered"] as const;

const inList = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/**
 * SQL predicate: item `i` of order `o` is overdue and may be refunded
 * without being asked. Its tracking is the item's own number, else the
 * order's when no item carries one (deliveryState.effectiveTrackingNumber).
 */
export function autoRefundableItemSql(now: Date): SQL {
  const tracking = sql`COALESCE(i.tracking_number, CASE WHEN NOT EXISTS (
    SELECT 1 FROM order_items j WHERE j.order_id = o.id AND j.tracking_number IS NOT NULL) THEN o.tracking_number END)`;
  const status = sql`CASE WHEN i.tracking_number IS NOT NULL THEN i.tracking_status ELSE o.tracking_status END`;
  return sql`(
    i.delivered_at IS NULL AND i.refunded_at IS NULL AND i.deliver_by < ${now}
    AND (
      ${tracking} IS NULL
      OR ${status} IN (${inList(CARRIER_FAILURE_STATUSES)})
      OR (
        ${status} IS DISTINCT FROM 'in_transit' AND ${status} IS DISTINCT FROM 'out_for_delivery'
        AND NOT EXISTS (
          SELECT 1 FROM order_tracking_events e
          WHERE e.order_id = o.id AND e.tracking_number = ${tracking} AND e.status IN (${inList(CARRIER_SCAN_STATUSES)})
        )
      )
      OR EXISTS (
        SELECT 1 FROM returns r
        WHERE r.order_id = o.id AND r.status IN ('pending', 'approved') AND ${notReceivedReasonSql(sql`r.reason`)}
      )
    )
  )`;
}

/**
 * A buyer's "not received" claim is a return request with that reason
 * (POST /api/returns, reason "Order not received" from the app's refund
 * request screen, or "not_received").
 */
export function notReceivedReasonSql(reason: SQL): SQL {
  return sql`(lower(${reason}) LIKE '%not received%' OR lower(${reason}) LIKE '%not_received%' OR lower(${reason}) LIKE '%never arrived%')`;
}

export type AutoRefundSummary = {
  checked: number;
  refunded: number;
  partial: number;
  skipped: number;
  failed: number;
};

export type AutoRefundDeps = {
  now?: Date;
  limit?: number;
  stripe?: Parameters<typeof refundOrder>[0]["stripe"];
  /** Last look at the carrier before refunding (polls tracking, may mark items delivered). */
  checkCarrier?: (orderId: string) => Promise<void>;
};

export async function runAutoRefundSweep(deps: AutoRefundDeps = {}): Promise<AutoRefundSummary> {
  const now = deps.now ?? new Date();
  const summary: AutoRefundSummary = { checked: 0, refunded: 0, partial: 0, skipped: 0, failed: 0 };
  if (!autoRefundEnabled()) return summary;

  const due = rows<{ id: string }>(await db.execute(sql`
    SELECT o.id FROM orders o
    WHERE o.deliver_by IS NOT NULL
      AND o.stripe_payment_intent_id IS NOT NULL
      AND o.status NOT IN ('cancelled', 'delivered')
      -- refund_pending is only ours to finish: our own refund is mid-flight
      -- (Stripe didn't confirm); a buyer/seller cancellation is not.
      AND (o.status <> 'refund_pending' OR EXISTS (
        SELECT 1 FROM order_refunds r
        WHERE r.order_id = o.id AND r.initiated_by = 'system:delivery-deadline' AND r.state IN ('processing', 'failed')
      ))
      AND o.funds_state IS DISTINCT FROM 'refunded'
      AND o.dispute_paused_at IS NULL
      AND (o.auto_refund_next_attempt_at IS NULL OR o.auto_refund_next_attempt_at <= ${now})
      AND EXISTS (
        SELECT 1 FROM order_items i
        WHERE i.order_id = o.id AND ${autoRefundableItemSql(now)}
      )
    ORDER BY o.deliver_by
    LIMIT ${deps.limit ?? 100}
  `));

  for (const { id } of due) {
    summary.checked++;
    try {
      const outcome = await refundOverdueItems(id, now, deps);
      summary[outcome]++;
    } catch (err) {
      summary.failed++;
      await recordAutoRefundFailure(id, err, now);
    }
  }
  return summary;
}

async function refundOverdueItems(orderId: string, now: Date, deps: AutoRefundDeps): Promise<"refunded" | "partial" | "skipped"> {
  if (deps.checkCarrier) {
    await deps.checkCarrier(orderId).catch((err) =>
      logger.warn({ err, orderId }, "Carrier check before auto-refund failed; using what we have"));
  }
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.disputePausedAt || ["cancelled", "delivered"].includes(order.status)) return "skipped";

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const eligible = new Set(rows<{ id: string }>(await db.execute(sql`
    SELECT i.id FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE i.order_id = ${orderId}::uuid AND ${autoRefundableItemSql(now)}
  `)).map((row) => row.id));
  const overdue = items.filter((i) => eligible.has(i.id));
  if (overdue.length === 0) return "skipped";
  const live = items.filter((i) => !i.refundedAt);
  const isFull = overdue.length === live.length;

  const charged = order.grossChargedCents > 0 ? order.grossChargedCents : order.totalCents;
  const amount = undeliveredRefundCents({
    chargedCents: charged,
    alreadyRefundedCents: order.refundedCents,
    allItems: items.map((i) => ({ id: i.id, priceCents: i.priceCents, quantity: i.quantity })),
    undeliveredItemIds: overdue.map((i) => i.id),
    alreadyRefundedItemIds: items.filter((i) => i.refundedAt).map((i) => i.id),
  });
  if (amount <= 0) return "skipped";

  // Pre-order deadlines follow the promised ship date, so say the real window.
  const latestDeadline = new Date(Math.max(...overdue.map((i) => i.deliverBy!.valueOf())));
  const windowDays = order.paidAt
    ? windowDaysBetween(order.paidAt, latestDeadline)
    : deliveryWindowDays(overdue.every((i) => i.isPreorder));
  const overdueIds = overdue.map((i) => i.id);
  const result = await refundOrder({
    orderId,
    amountCents: amount,
    reason: "not_delivered",
    initiatedBy: "system:delivery-deadline",
    idempotencyKey: autoRefundKey(orderId, overdueIds),
    stripe: deps.stripe,
    allowFromShipped: true,
    ...(isFull ? {
      cancelOrder: {
        reason: AUTO_REFUND_REASON,
        notes: `This order wasn't delivered within ${windowDays} days, so you were refunded automatically.`,
        restock: false,
      },
    } : {}),
    // Re-checked under the order lock: a delivery scan or a chargeback that
    // landed since the query above wins.
    precondition: async (_locked, tx) => {
      const [fresh] = await tx.select({ paused: orders.disputePausedAt, status: orders.status }).from(orders)
        .where(eq(orders.id, orderId)).limit(1);
      const current = await tx.select({ id: orderItems.id, deliveredAt: orderItems.deliveredAt, refundedAt: orderItems.refundedAt })
        .from(orderItems).where(eq(orderItems.orderId, orderId));
      const stillOverdue = new Set(current.filter((i) => !i.deliveredAt && !i.refundedAt).map((i) => i.id));
      if (fresh?.paused || overdueIds.some((id) => !stillOverdue.has(id))) {
        throw new RefundError("Auto-refund no longer needed", 409, "AUTO_REFUND_NOT_NEEDED");
      }
    },
    onSucceeded: async (tx, { order: locked, amountCents, refundId }) => {
      // Spread the refunded cents over the refunded items (last item takes the rounding).
      const total = overdue.reduce((sum, i) => sum + i.priceCents * i.quantity, 0) || 1;
      let assigned = 0;
      for (const [index, item] of overdue.entries()) {
        const share = index === overdue.length - 1
          ? amountCents - assigned
          : Math.floor((amountCents * item.priceCents * item.quantity) / total);
        assigned += share;
        await tx.update(orderItems).set({ refundedAt: now, refundedCents: share }).where(eq(orderItems.id, item.id));
      }
      await tx.update(orders).set({
        autoRefundedAt: now, autoRefundAttempts: 0, autoRefundNextAttemptAt: null, autoRefundLastError: null,
        updatedAt: new Date(),
      }).where(eq(orders.id, orderId));
      await refreshOrderDeadline(tx, orderId);
      await finalizeIfAllDelivered(tx, orderId);
      if (isFull) {
        // The buyer's "not received" claim is answered by this refund.
        await tx.execute(sql`
          UPDATE returns r SET status = 'refunded', refund_amount_cents = ${amountCents}, updated_at = now()
          WHERE r.order_id = ${orderId}::uuid AND r.status IN ('pending', 'approved') AND ${notReceivedReasonSql(sql`r.reason`)}
        `);
      }
      if (locked.buyer_id) {
        await reversePurchasePointsOnce({
          buyerId: locked.buyer_id,
          orderId: locked.id,
          referenceId: `${locked.id}:refund:${refundId}`,
          requestedPoints: Math.floor(amountCents / 100),
          note: `Purchase reward reversed after order ${locked.order_number} wasn't delivered in time`,
        }, tx);
      }
    },
  }).catch((err) => {
    if (err instanceof RefundError && (err.code === "AUTO_REFUND_NOT_NEEDED" || err.code === "ALREADY_REFUNDED")) return null;
    throw err;
  });
  if (!result) return "skipped";
  if (!result.duplicate) {
    await notifyAutoRefunded({
      id: order.id, orderNumber: order.orderNumber, buyerId: order.buyerId, ownerId: order.ownerId,
      refundedCents: result.amountCents, partial: !isFull, windowDays,
    });
    logger.info({ orderId, amountCents: result.amountCents, partial: !isFull }, "Order auto-refunded: not delivered in time");
  }
  return isFull ? "refunded" : "partial";
}

async function recordAutoRefundFailure(orderId: string, err: unknown, now: Date): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  const code = err instanceof RefundError ? err.code : undefined;
  const [updated] = await db.update(orders).set({
    autoRefundAttempts: sql`${orders.autoRefundAttempts} + 1`,
    autoRefundLastError: `${code ? `${code}: ` : ""}${message}`,
    updatedAt: new Date(),
  }).where(eq(orders.id, orderId)).returning({ attempts: orders.autoRefundAttempts });
  const attempts = updated?.attempts ?? 1;
  await db.update(orders).set({
    autoRefundNextAttemptAt: new Date(now.valueOf() + refundRetryDelayMs(attempts)),
  }).where(eq(orders.id, orderId));
  // Every failure is an error-level log (reported to Sentry). From the third
  // attempt it carries the alert tag so it pages a person.
  logger.error({
    err, orderId, attempts, code,
    ...(attempts >= STUCK_AFTER_ATTEMPTS ? { alert: "auto_refund_stuck" } : {}),
  }, attempts >= STUCK_AFTER_ATTEMPTS
    ? "ALERT: automatic non-delivery refund keeps failing; a person must review"
    : "Automatic non-delivery refund failed; will retry");
}

// ─── Seller warnings ──────────────────────────────────────────────────────────

/** 5 days, 2 days and 12 hours before an unshipped item's deadline. */
export async function runDeadlineWarnings(now = new Date(), limit = 200): Promise<number> {
  const candidates = rows<{
    id: string; order_number: string; buyer_id: string | null; owner_id: string; due_by: Date; level: number;
  }>(await db.execute(sql`
    SELECT o.id, o.order_number, o.buyer_id, o.owner_id, o.deadline_warning_level AS level,
      (SELECT min(i.deliver_by) FROM order_items i
        WHERE i.order_id = o.id AND i.refunded_at IS NULL AND i.delivered_at IS NULL AND i.tracking_number IS NULL
          AND (o.tracking_number IS NULL OR EXISTS (
            SELECT 1 FROM order_items j WHERE j.order_id = o.id AND j.tracking_number IS NOT NULL))) AS due_by
    FROM orders o
    WHERE o.deliver_by IS NOT NULL AND o.deliver_by > ${now}
      AND o.status NOT IN ('cancelled', 'refund_pending', 'delivered')
      AND o.dispute_paused_at IS NULL
      AND o.deadline_warning_level < 3
      AND o.deliver_by <= ${new Date(now.valueOf() + 5 * 86_400_000)}
    ORDER BY o.deliver_by
    LIMIT ${limit}
  `)).filter((row) => row.due_by);

  let sent = 0;
  for (const row of candidates) {
    const dueBy = new Date(row.due_by);
    const level = dueWarningLevel(dueBy, now);
    if (level === 0 || level <= row.level) continue;
    const [claimed] = await db.update(orders).set({ deadlineWarningLevel: level })
      .where(and(eq(orders.id, row.id), sql`${orders.deadlineWarningLevel} < ${level}`))
      .returning({ id: orders.id });
    if (!claimed) continue;
    await notifySellerDeadlineWarning({
      id: row.id, orderNumber: row.order_number, buyerId: row.buyer_id, ownerId: row.owner_id, deliverBy: dueBy,
    }, level);
    sent++;
  }
  return sent;
}
