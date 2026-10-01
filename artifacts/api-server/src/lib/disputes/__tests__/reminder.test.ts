import { describe, expect, it, vi } from "vitest";
import { runDisputeEvidenceReminder, type ReminderCandidateRow, type ReminderDeps } from "../reminder";
import { isEvidenceReminderDue, reminderEventId, buildDisputeNotification } from "../notifications";

const now = new Date("2026-10-10T12:00:00.000Z");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000);

const row = (over: Partial<ReminderCandidateRow> = {}): ReminderCandidateRow => ({
  id: "d1", sellerId: "seller_1", status: "needs_response", amountCents: 4200, currency: "usd",
  orderId: "o1", evidenceDueBy: hours(40), evidenceSubmittedAt: null, ...over,
});

describe("isEvidenceReminderDue", () => {
  it("selects disputes due within 48 hours that have no submission", () => {
    expect(isEvidenceReminderDue(row(), now)).toBe(true);
    expect(isEvidenceReminderDue(row({ evidenceDueBy: hours(48) }), now)).toBe(true);
  });
  it("skips outside the window, submitted, finished or unknown-seller disputes", () => {
    expect(isEvidenceReminderDue(row({ evidenceDueBy: hours(49) }), now)).toBe(false);
    expect(isEvidenceReminderDue(row({ evidenceDueBy: hours(-1) }), now)).toBe(false);
    expect(isEvidenceReminderDue(row({ evidenceDueBy: null }), now)).toBe(false);
    expect(isEvidenceReminderDue(row({ evidenceSubmittedAt: now }), now)).toBe(false);
    expect(isEvidenceReminderDue(row({ status: "under_review" }), now)).toBe(false);
    expect(isEvidenceReminderDue(row({ status: "won" }), now)).toBe(false);
    expect(isEvidenceReminderDue(row({ sellerId: "unknown" }), now)).toBe(false);
  });
  it("keys the reminder per deadline", () => {
    expect(reminderEventId("d1", hours(40))).not.toBe(reminderEventId("d1", hours(41)));
  });
});

describe("runDisputeEvidenceReminder", () => {
  function makeDeps(candidates: ReminderCandidateRow[]) {
    const claimed = new Set<string>();
    const notify = vi.fn(async () => {});
    const deps: ReminderDeps = {
      findCandidates: async () => candidates,
      claim: async (_id, eventId) => { if (claimed.has(eventId)) return false; claimed.add(eventId); return true; },
      release: async (eventId) => { claimed.delete(eventId); },
      orderNumber: async () => "#1042",
      notify,
    };
    return { deps, notify, claimed };
  }

  it("sends one reminder per dispute however often it runs", async () => {
    const { deps, notify } = makeDeps([row(), row({ id: "d2", evidenceDueBy: hours(60) })]);
    expect(await runDisputeEvidenceReminder(now, deps)).toBe(1);
    expect(await runDisputeEvidenceReminder(now, deps)).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as any)[0]).toMatchObject({
      userId: "seller_1", category: "dispute", type: "dispute_evidence_due", targetId: "d1",
      cta: "/dispute-detail?disputeId=d1",
    });
  });

  it("releases the claim when sending fails so the next run retries", async () => {
    const { deps, notify } = makeDeps([row()]);
    notify.mockRejectedValueOnce(new Error("push down"));
    expect(await runDisputeEvidenceReminder(now, deps)).toBe(0);
    expect(await runDisputeEvidenceReminder(now, deps)).toBe(1);
  });

  it("uses plain copy", () => {
    const c = buildDisputeNotification("evidence_due_soon", { amountCents: 4200, currency: "usd", orderNumber: "#1042", evidenceDueBy: hours(40) });
    expect(c.title).toBe("Dispute evidence due in 2 days");
    expect(c.body).toContain("$42.00");
    expect(c.body).toContain("#1042");
  });
});
