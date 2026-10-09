/**
 * Dispute evidence reminder: tells the seller once, about 48 hours before the
 * evidence deadline, that they still haven't submitted evidence. The selection
 * and claim logic is in lib/disputes/reminder.ts; this wires the database.
 */
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db, disputes, disputeEvents, orders } from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { EVIDENCE_REMINDER_LEAD_MS } from "../lib/disputes/notifications";
import { runDisputeEvidenceReminder as runReminder, type ReminderDeps } from "../lib/disputes/reminder";
import { scheduleJob } from "./runner";

const INTERVAL_MS = 30 * 60 * 1000;

export const dbReminderDeps: ReminderDeps = {
  async findCandidates(now) {
    return db.select({
      id: disputes.id,
      sellerId: disputes.sellerId,
      status: disputes.status,
      amountCents: disputes.amountCents,
      currency: disputes.currency,
      orderId: disputes.orderId,
      evidenceDueBy: disputes.evidenceDueBy,
      evidenceSubmittedAt: disputes.evidenceSubmittedAt,
    }).from(disputes).where(and(
      inArray(disputes.status, ["needs_response", "evidence_submitted"]),
      isNull(disputes.evidenceSubmittedAt),
      gt(disputes.evidenceDueBy, now),
      lte(disputes.evidenceDueBy, new Date(now.getTime() + EVIDENCE_REMINDER_LEAD_MS)),
    ));
  },
  async claim(disputeId, eventId, now) {
    const [row] = await db.insert(disputeEvents).values({
      disputeId,
      stripeEventId: eventId,
      kind: "evidence_due_soon",
      payload: {},
      occurredAt: now,
      notifiedAt: now,
    }).onConflictDoNothing({ target: disputeEvents.stripeEventId }).returning({ id: disputeEvents.id });
    return !!row;
  },
  async release(eventId) {
    await db.delete(disputeEvents).where(eq(disputeEvents.stripeEventId, eventId));
  },
  async orderNumber(orderId) {
    if (!orderId) return null;
    const [row] = await db.select({ n: orders.orderNumber }).from(orders).where(eq(orders.id, orderId)).limit(1);
    return row?.n ?? null;
  },
  notify: publishNotification,
};

export function runDisputeEvidenceReminder(now = new Date()): Promise<number> {
  return runReminder(now, dbReminderDeps);
}

export function startDisputeEvidenceReminderJob(): void {
  scheduleJob("disputeEvidenceReminder", () => runDisputeEvidenceReminder(), { intervalMs: INTERVAL_MS, initialDelayMs: 2 * 60 * 1000 });
}
