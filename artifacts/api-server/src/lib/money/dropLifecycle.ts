/**
 * Failed preorder drops. When a drop's fulfilment deadline passes with
 * orders still unshipped (the bulk order never arrived), or the seller
 * cancels the drop, every buyer whose order has not shipped is refunded
 * automatically and in full. Orders that already shipped keep their release.
 *
 * Every step is idempotent (refund keys are "drop-failed/<orderId>"), so the
 * scheduled job can run as often as it likes and crash at any point.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, drops, orders } from "@workspace/db";
import { logger } from "../logger";
import { publishNotification } from "../../routes/notifications-feed";
import { reversePurchasePointsOnce } from "../../routes/loyalty";
import { advanceDropEscrow, recoverLabelCost, sweepOrderReleases } from "./escrow";
import { refundOrder, RefundError } from "./refunds";
import { DROP_OPEN_STATES, orderStatusMachine, type OrderStatus } from "./stateMachines";

/**
 * The longest a preorder drop may keep buyer money. Card networks allow
 * "not received" disputes for up to 120 days after the expected delivery
 * date (540 days at most), and refunds to old cards get less reliable over
 * time, so Brandthread caps holds well inside that window. Confirm with
 * Stripe before raising it (see docs/payments/money-flow.md).
 */
export const MAX_PREORDER_HOLD_DAYS = 180;
/** Deadline used when a seller gives an estimated ship date but no deadline. */
export const DEFAULT_DEADLINE_GRACE_DAYS = 30;

export type DropFailureReason = "deadline_passed" | "seller_cancelled";

export type DropFailureSummary = {
  dropId: string;
  state: string | null;
  refunded: number;
  pending: number;
  errors: number;
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

export function defaultFulfillmentDeadline(input: { estimatedShipDate?: Date | null; now?: Date }): Date {
  const now = input.now ?? new Date();
  const max = new Date(now.valueOf() + MAX_PREORDER_HOLD_DAYS * 86_400_000);
  const fromShipDate = input.estimatedShipDate
    ? new Date(input.estimatedShipDate.valueOf() + DEFAULT_DEADLINE_GRACE_DAYS * 86_400_000)
    : max;
  return fromShipDate < max ? fromShipDate : max;
}

/** Validates a seller-supplied deadline. Returns an error message or null. */
export function validateFulfillmentDeadline(deadline: Date, now = new Date()): string | null {
  if (Number.isNaN(deadline.valueOf())) return "fulfillmentDeadlineAt must be a valid ISO date";
  if (deadline.valueOf() <= now.valueOf()) return "fulfillmentDeadlineAt must be in the future";
  if (deadline.valueOf() > now.valueOf() + MAX_PREORDER_HOLD_DAYS * 86_400_000) {
    return `fulfillmentDeadlineAt can be at most ${MAX_PREORDER_HOLD_DAYS} days away`;
  }
  return null;
}

/**
 * Marks the drop as failing and refunds every unshipped order. Returns what
 * happened; a refund that could not complete now is retried by the job.
 */
export async function failDrop(
  dropId: string,
  reason: DropFailureReason,
  initiatedBy: string,
): Promise<DropFailureSummary> {
  await advanceDropEscrow(db, dropId, "failing", {
    escrowFailedAt: new Date(),
    escrowFailureReason: reason,
  });
  const [drop] = await db.select({ escrowState: drops.escrowState, name: drops.name })
    .from(drops).where(eq(drops.id, dropId)).limit(1);
  const summary: DropFailureSummary = { dropId, state: drop?.escrowState ?? null, refunded: 0, pending: 0, errors: 0 };
  if (drop?.escrowState !== "failing") return summary;

  const unshipped = await db.select({
    id: orders.id,
    status: orders.status,
    buyerId: orders.buyerId,
    orderNumber: orders.orderNumber,
  }).from(orders).where(and(
    eq(orders.dropId, dropId),
    eq(orders.chargeModel, "held"),
    eq(orders.fundsState, "held"),
  ));

  for (const order of unshipped) {
    const status = order.status as OrderStatus;
    const canCancel = status === "refund_pending"
      || (orderStatusMachine.isState(status) && orderStatusMachine.can(status, "refund_pending"));
    try {
      const result = await refundOrder({
        orderId: order.id,
        reason: "drop_failed",
        initiatedBy,
        idempotencyKey: `drop-failed/${order.id}`,
        ...(canCancel ? {
          cancelOrder: {
            reason: "production_issue",
            notes: reason === "deadline_passed"
              ? "This preorder could not be made in time, so you were refunded automatically."
              : "The seller cancelled this preorder drop, so you were refunded automatically.",
            restock: false,
          },
        } : {}),
        onSucceeded: async (tx, { order: locked, amountCents, refundId }) => {
          if (locked.buyer_id) {
            await reversePurchasePointsOnce({
              buyerId: locked.buyer_id,
              orderId: locked.id,
              referenceId: `${locked.id}:refund:${refundId}`,
              requestedPoints: Math.floor(amountCents / 100),
              note: `Purchase reward reversed after preorder ${locked.order_number} was refunded`,
            }, tx);
          }
        },
      });
      if (!result.duplicate) summary.refunded++;
      if (order.buyerId && !result.duplicate) {
        publishNotification({
          userId: order.buyerId,
          category: "orders",
          type: "order_cancelled",
          title: "Preorder refunded",
          body: `Order #${order.orderNumber} from ${drop.name} couldn't be fulfilled. You've been refunded in full.`,
          targetId: order.id,
          targetType: "order",
        }).catch(() => { /* notification is best-effort */ });
      }
    } catch (err) {
      if (err instanceof RefundError && err.code === "RELEASE_IN_PROGRESS") {
        summary.pending++;
        continue;
      }
      summary.errors++;
      logger.error({ err, dropId, orderId: order.id }, "Failed-drop refund did not complete; the job will retry");
    }
  }

  const [remaining] = rows<{ held: number; processing: number }>(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM orders
        WHERE drop_id = ${dropId}::uuid AND charge_model = 'held' AND funds_state IN ('held', 'release_pending')) AS held,
      (SELECT count(*)::int FROM order_refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.drop_id = ${dropId}::uuid AND r.state = 'processing') AS processing
  `));
  if ((remaining?.held ?? 0) === 0 && (remaining?.processing ?? 0) === 0) {
    await advanceDropEscrow(db, dropId, "failed");
    summary.state = "failed";
  }
  return summary;
}

/**
 * The scheduled safety net for all held money:
 *  1. Fail drops whose deadline passed with unshipped orders (auto-refund);
 *     complete them instead when every order already shipped.
 *  2. Keep retrying drops that are mid-failure.
 *  3. Finish per-order releases left behind by a crash or Stripe outage.
 *  4. Retry label-cost recovery for in-stock orders.
 */
export async function runMoneySweep(now = new Date()): Promise<{
  failedDrops: DropFailureSummary[];
  completedDrops: number;
  releasesSettled: number;
}> {
  const overdue = await db.select({ id: drops.id }).from(drops).where(and(
    inArray(drops.escrowState, [...DROP_OPEN_STATES]),
    lt(drops.fulfillmentDeadlineAt, now),
  ));
  const failedDrops: DropFailureSummary[] = [];
  let completedDrops = 0;
  for (const drop of overdue) {
    const [held] = await db.select({ id: orders.id }).from(orders).where(and(
      eq(orders.dropId, drop.id),
      eq(orders.chargeModel, "held"),
      eq(orders.fundsState, "held"),
    )).limit(1);
    if (held) {
      failedDrops.push(await failDrop(drop.id, "deadline_passed", "system:drop-deadline"));
    } else {
      const [inFlight] = await db.select({ id: orders.id }).from(orders).where(and(
        eq(orders.dropId, drop.id), eq(orders.fundsState, "release_pending"),
      )).limit(1);
      if (!inFlight && await advanceDropEscrow(db, drop.id, "completed")) completedDrops++;
    }
  }

  const failing = await db.select({ id: drops.id, reason: drops.escrowFailureReason })
    .from(drops).where(eq(drops.escrowState, "failing"));
  for (const drop of failing) {
    if (failedDrops.some((d) => d.dropId === drop.id)) continue;
    failedDrops.push(await failDrop(
      drop.id,
      drop.reason === "seller_cancelled" ? "seller_cancelled" : "deadline_passed",
      "system:drop-retry",
    ));
  }

  const releasesSettled = await sweepOrderReleases({ now });

  const unrecovered = rows<{ id: string }>(await db.execute(sql`
    SELECT l.id FROM shipping_labels l JOIN orders o ON o.id = l.order_id
    WHERE o.charge_model = 'destination' AND l.status = 'active'
      AND EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.idempotency_key = 'label/' || l.id)
      AND NOT EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.idempotency_key = 'label-recovery/' || l.id)
    LIMIT 100
  `));
  for (const label of unrecovered) await recoverLabelCost(label.id);

  return { failedDrops, completedDrops, releasesSettled };
}
