/**
 * Dispute evidence reminder logic (database-free; the job in
 * jobs/disputeEvidenceReminder.ts supplies the real dependencies).
 *
 * Idempotent: the reminder is claimed by inserting a dispute_events row whose
 * stripe_event_id is derived from the dispute and deadline ("reminder-48h/...").
 * Only the run that inserts it sends the notification, and the claim is
 * removed again if sending fails so the next run retries.
 */
import { logger } from "../logger";
import {
  buildDisputeNotification, disputeDeepLink, disputeNotificationType,
  isEvidenceReminderDue, reminderEventId,
} from "./notifications";

export type ReminderCandidateRow = {
  id: string;
  sellerId: string;
  status: string;
  amountCents: number;
  currency: string;
  orderId: string | null;
  evidenceDueBy: Date | null;
  evidenceSubmittedAt: Date | null;
};

export interface ReminderDeps {
  findCandidates(now: Date): Promise<ReminderCandidateRow[]>;
  /** Insert the claim row; false when this reminder was already claimed. */
  claim(disputeId: string, eventId: string, now: Date): Promise<boolean>;
  release(eventId: string): Promise<void>;
  orderNumber(orderId: string | null): Promise<string | null>;
  notify(n: {
    userId: string; category: string; type: string; title: string; body: string;
    targetId: string; targetType: string; cta: string;
  }): Promise<void>;
}

/** Returns how many reminders were sent. */
export async function runDisputeEvidenceReminder(now: Date, deps: ReminderDeps): Promise<number> {
  let sent = 0;
  try {
    const candidates = await deps.findCandidates(now);
    for (const d of candidates) {
      // Re-check in code: the query is a coarse filter, this is the rule.
      if (!isEvidenceReminderDue(d, now) || !d.evidenceDueBy) continue;
      const eventId = reminderEventId(d.id, d.evidenceDueBy);
      if (!await deps.claim(d.id, eventId, now)) continue;
      try {
        const copy = buildDisputeNotification("evidence_due_soon", {
          amountCents: d.amountCents,
          currency: d.currency,
          orderNumber: await deps.orderNumber(d.orderId),
          evidenceDueBy: d.evidenceDueBy,
        });
        await deps.notify({
          userId: d.sellerId,
          category: "dispute",
          type: disputeNotificationType("evidence_due_soon"),
          title: copy.title,
          body: copy.body,
          targetId: d.id,
          targetType: "dispute",
          cta: disputeDeepLink(d.id),
        });
        sent += 1;
      } catch (err) {
        await deps.release(eventId).catch(() => {});
        logger.error({ err, disputeId: d.id, job: "disputeEvidenceReminder" }, "Dispute reminder failed; will retry");
      }
    }
  } catch (err) {
    logger.error({ err, job: "disputeEvidenceReminder" }, "Dispute evidence reminder job failed");
  }
  return sent;
}

