/** Drizzle-backed implementations of the dispute webhook dependencies. */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, disputes, disputeEvents, orders } from "@workspace/db";
import { logger } from "../logger";
import { recordDisputeReinstatement, recordDisputeWithdrawal } from "../money/disputes";
import { recordDisputeClosedRecovery } from "../money/sellerRecovery";
import type { DisputeDeps, DisputeStore } from "./webhook";

const STATUS_EVENT_KINDS = ["created", "updated", "evidence_submitted", "won", "lost", "warning_closed"] as const;

export const dbDisputeStore: DisputeStore = {
  async resolveSellerAndOrder(paymentIntentId, chargeId) {
    if (paymentIntentId) {
      const [ord] = await db.select({ id: orders.id, ownerId: orders.ownerId })
        .from(orders).where(eq(orders.stripePaymentIntentId, paymentIntentId)).limit(1);
      if (ord) return { sellerId: ord.ownerId, orderId: ord.id };
    }
    if (chargeId) {
      const [ord] = await db.select({ id: orders.id, ownerId: orders.ownerId })
        .from(orders).where(eq(orders.stripeChargeId, chargeId)).limit(1);
      if (ord) return { sellerId: ord.ownerId, orderId: ord.id };
    }
    return { sellerId: "unknown", orderId: null };
  },

  async upsertDispute(values) {
    await db.insert(disputes).values(values).onConflictDoNothing({ target: disputes.stripeDisputeId });
    const [row] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, values.stripeDisputeId)).limit(1);
    // A dispute first seen with an unknown seller may resolve once the order is linked.
    if (row.sellerId === "unknown" && values.sellerId !== "unknown") {
      const [fixed] = await db.update(disputes)
        .set({ sellerId: values.sellerId, orderId: values.orderId, updatedAt: new Date() })
        .where(and(eq(disputes.id, row.id), eq(disputes.sellerId, "unknown")))
        .returning();
      return fixed ?? row;
    }
    return row;
  },

  async updateDispute(id, patch) {
    await db.update(disputes).set({ ...patch, updatedAt: new Date() }).where(eq(disputes.id, id));
  },

  async hasEvent(disputeId, kind) {
    const [row] = await db.select({ id: disputeEvents.id }).from(disputeEvents)
      .where(and(eq(disputeEvents.disputeId, disputeId), eq(disputeEvents.kind, kind))).limit(1);
    return !!row;
  },

  async latestStatusEventAt(disputeId) {
    const [row] = await db.select({ at: sql<Date | null>`MAX(${disputeEvents.occurredAt})` })
      .from(disputeEvents)
      .where(and(eq(disputeEvents.disputeId, disputeId), inArray(disputeEvents.kind, [...STATUS_EVENT_KINDS])));
    return row?.at ? new Date(row.at) : null;
  },

  async insertEvent(row) {
    const [created] = await db.insert(disputeEvents).values(row)
      .onConflictDoNothing({ target: disputeEvents.stripeEventId })
      .returning({ id: disputeEvents.id, notifiedAt: disputeEvents.notifiedAt });
    if (created) return { id: created.id, inserted: true, notifiedAt: created.notifiedAt };
    const [existing] = await db.select({ id: disputeEvents.id, notifiedAt: disputeEvents.notifiedAt })
      .from(disputeEvents).where(eq(disputeEvents.stripeEventId, row.stripeEventId)).limit(1);
    return { id: existing.id, inserted: false, notifiedAt: existing.notifiedAt };
  },

  async claimNotification(eventRowId) {
    const [claimed] = await db.update(disputeEvents).set({ notifiedAt: new Date() })
      .where(and(eq(disputeEvents.id, eventRowId), isNull(disputeEvents.notifiedAt)))
      .returning({ id: disputeEvents.id });
    return !!claimed;
  },

  async releaseNotification(eventRowId) {
    await db.update(disputeEvents).set({ notifiedAt: null }).where(eq(disputeEvents.id, eventRowId));
  },

  async orderNumber(orderId) {
    if (!orderId) return null;
    const [row] = await db.select({ n: orders.orderNumber }).from(orders).where(eq(orders.id, orderId)).limit(1);
    return row?.n ?? null;
  },
};

/** Real dependencies; `notify` is passed in to avoid importing routes from lib at module load. */
export function buildDisputeDeps(notify: DisputeDeps["notify"]): DisputeDeps {
  return {
    store: dbDisputeStore,
    ledger: {
      withdraw: (input) => recordDisputeWithdrawal(input),
      reinstate: (input) => recordDisputeReinstatement(input),
      settle: (input) => recordDisputeClosedRecovery(input),
    },
    notify,
    log: logger,
  };
}
