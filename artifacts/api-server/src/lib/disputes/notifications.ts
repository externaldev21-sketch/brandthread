/** Seller notification copy for disputes, and which disputes are due a reminder. */

export type DisputeNotificationKind = "created" | "evidence_due_soon" | "won" | "lost";

export const EVIDENCE_REMINDER_LEAD_MS = 48 * 60 * 60 * 1000;

export function formatDisputeAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
      .format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function fmtDue(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type DisputeCopyInput = {
  amountCents: number;
  currency: string;
  orderNumber?: string | null;
  evidenceDueBy?: Date | null;
  isInquiry?: boolean;
};

const DISPUTE_TYPE: Record<DisputeNotificationKind, string> = {
  created: "dispute_created",
  evidence_due_soon: "dispute_evidence_due",
  won: "dispute_won",
  lost: "dispute_lost",
};

export function disputeNotificationType(kind: DisputeNotificationKind): string {
  return DISPUTE_TYPE[kind];
}

export function buildDisputeNotification(
  kind: DisputeNotificationKind,
  input: DisputeCopyInput,
): { title: string; body: string } {
  const amount = formatDisputeAmount(input.amountCents, input.currency);
  const order = input.orderNumber ? ` on order ${input.orderNumber}` : "";
  switch (kind) {
    case "created": {
      const what = input.isInquiry ? "inquiry" : "dispute";
      const title = input.isInquiry ? `Payment inquiry for ${amount}` : `New dispute for ${amount}`;
      const due = input.evidenceDueBy
        ? `Submit evidence by ${fmtDue(input.evidenceDueBy)}.`
        : "Submit evidence as soon as you can.";
      return { title, body: `A customer opened a ${what}${order}. ${due}` };
    }
    case "evidence_due_soon":
      return {
        title: "Dispute evidence due in 2 days",
        body: input.evidenceDueBy
          ? `Evidence for the ${amount} dispute${order} is due ${fmtDue(input.evidenceDueBy)}. It can't be submitted after that.`
          : `Evidence for the ${amount} dispute${order} is due soon.`,
      };
    case "won":
      return { title: "Dispute won", body: `You won the ${amount} dispute${order}. The money is returned to you.` };
    case "lost":
      return { title: "Dispute lost", body: `You lost the ${amount} dispute${order}. The money went back to the customer.` };
  }
}

export function disputeDeepLink(disputeId: string): string {
  return `/dispute-detail?disputeId=${encodeURIComponent(disputeId)}`;
}

export type ReminderCandidate = {
  status: string;
  evidenceDueBy: Date | null;
  evidenceSubmittedAt: Date | null;
  sellerId: string;
};

/**
 * A reminder is due when the dispute still needs a response, nothing has been
 * submitted, the seller is known, and the deadline is in the future but within
 * 48 hours.
 */
export function isEvidenceReminderDue(d: ReminderCandidate, now: Date): boolean {
  if (d.status !== "needs_response" && d.status !== "evidence_submitted") return false;
  if (d.evidenceSubmittedAt || !d.evidenceDueBy || d.sellerId === "unknown") return false;
  const left = d.evidenceDueBy.getTime() - now.getTime();
  return left > 0 && left <= EVIDENCE_REMINDER_LEAD_MS;
}

/** One reminder per dispute per deadline (an extended deadline earns a new one). */
export function reminderEventId(disputeId: string, dueBy: Date): string {
  return `reminder-48h/${disputeId}/${dueBy.getTime()}`;
}
