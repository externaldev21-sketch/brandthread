import { describe, expect, it, vi } from "vitest";
import {
  processDisputeEvent, mapDisputeStatus, disputeFeeCents,
  type DisputeDeps, type DisputeRowLike, type DisputeStore, type InsertDispute,
} from "../webhook";

type StoredEvent = { id: string; disputeId: string; stripeEventId: string; kind: string; payload: any; occurredAt: Date; notifiedAt: Date | null };

function makeStore(orders: Record<string, { sellerId: string; orderId: string; orderNumber: string }> = {}) {
  const disputes = new Map<string, DisputeRowLike>();
  const events: StoredEvent[] = [];
  let seq = 0;
  const store: DisputeStore = {
    async resolveSellerAndOrder(pi) {
      const o = pi ? orders[pi] : undefined;
      return o ? { sellerId: o.sellerId, orderId: o.orderId } : { sellerId: "unknown", orderId: null };
    },
    async upsertDispute(v: InsertDispute) {
      let row = disputes.get(v.stripeDisputeId);
      if (!row) {
        row = {
          id: `d${++seq}`, stripeDisputeId: v.stripeDisputeId, orderId: v.orderId, sellerId: v.sellerId,
          amountCents: v.amountCents, currency: v.currency, status: v.status,
          evidenceDueBy: v.evidenceDueBy, evidenceSubmittedAt: null,
        };
        disputes.set(v.stripeDisputeId, row);
      }
      return row;
    },
    async updateDispute(id, patch) {
      const row = [...disputes.values()].find((d) => d.id === id)!;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.evidenceDueBy !== undefined) row.evidenceDueBy = patch.evidenceDueBy;
    },
    async hasEvent(disputeId, kind) { return events.some((e) => e.disputeId === disputeId && e.kind === kind); },
    async latestStatusEventAt(disputeId) {
      const times = events
        .filter((e) => e.disputeId === disputeId && ["created", "updated", "evidence_submitted", "won", "lost", "warning_closed"].includes(e.kind))
        .map((e) => e.occurredAt.getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    },
    async insertEvent(row) {
      const existing = events.find((e) => e.stripeEventId === row.stripeEventId);
      if (existing) return { id: existing.id, inserted: false, notifiedAt: existing.notifiedAt };
      const created = { ...row, id: `e${++seq}`, notifiedAt: null };
      events.push(created);
      return { id: created.id, inserted: true, notifiedAt: null };
    },
    async claimNotification(id) {
      const e = events.find((x) => x.id === id)!;
      if (e.notifiedAt) return false;
      e.notifiedAt = new Date();
      return true;
    },
    async releaseNotification(id) { events.find((x) => x.id === id)!.notifiedAt = null; },
    async orderNumber(orderId) {
      return Object.values(orders).find((o) => o.orderId === orderId)?.orderNumber ?? null;
    },
  };
  return { store, disputes, events };
}

function makeDeps(store: DisputeStore) {
  const notify = vi.fn(async () => {});
  const withdraw = vi.fn(async () => ({}));
  const reinstate = vi.fn(async () => ({}));
  const deps: DisputeDeps = { store, ledger: { withdraw, reinstate }, notify };
  return { deps, notify, withdraw, reinstate };
}

const order = { sellerId: "seller_1", orderId: "o1", orderNumber: "#1042" };

function ev(type: string, id: string, object: Record<string, unknown>, created = 1_800_000_000) {
  return {
    id, type, created,
    data: { object: {
      id: "dp_1", amount: 4200, currency: "usd", reason: "product_not_received", status: "needs_response",
      payment_intent: "pi_1", charge: "ch_1",
      evidence_details: { due_by: 1_800_864_000, submission_count: 0 },
      ...object,
    } },
  };
}

describe("dispute webhook processing", () => {
  it("maps Stripe statuses", () => {
    expect(mapDisputeStatus("warning_needs_response")).toBe("needs_response");
    expect(mapDisputeStatus("warning_closed")).toBe("closed");
    expect(mapDisputeStatus("won")).toBe("won");
  });

  it("creates the dispute, a timeline row and notifies the seller with the deadline and deep link", async () => {
    const { store, disputes, events } = makeStore({ pi_1: order });
    const { deps, notify } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", {}), deps);
    expect(disputes.size).toBe(1);
    expect(events.map((e) => e.kind)).toEqual(["created"]);
    expect(notify).toHaveBeenCalledTimes(1);
    const n = (notify.mock.calls[0] as any)[0];
    expect(n).toMatchObject({ userId: "seller_1", category: "dispute", type: "dispute_created", targetType: "dispute" });
    expect(n.cta).toBe("/dispute-detail?disputeId=d1");
    expect(n.title).toBe("New dispute for $42.00");
    expect(n.body).toContain("order #1042");
    expect(n.body).toContain("Submit evidence by");
  });

  it("is idempotent when the same event is replayed", async () => {
    const { store, events } = makeStore({ pi_1: order });
    const { deps, notify, withdraw } = makeDeps(store);
    const created = ev("charge.dispute.created", "evt_1", {});
    const withdrawn = ev("charge.dispute.funds_withdrawn", "evt_2", {});
    for (let i = 0; i < 3; i++) {
      const r1 = await processDisputeEvent(created, deps);
      const r2 = await processDisputeEvent(withdrawn, deps);
      expect(r1.duplicate).toBe(i > 0);
      expect(r2.duplicate).toBe(i > 0);
    }
    expect(events).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(1);
    // The ledger call is repeated but keyed per event, so it posts once.
    for (const call of withdraw.mock.calls) expect((call as any)[0].stripeEventId).toBe("evt_2");
  });

  it("re-sends a notification that failed on the first attempt, once", async () => {
    const { store } = makeStore({ pi_1: order });
    const { deps, notify } = makeDeps(store);
    notify.mockRejectedValueOnce(new Error("push down"));
    const created = ev("charge.dispute.created", "evt_1", {});
    await expect(processDisputeEvent(created, deps)).rejects.toThrow("push down");
    await processDisputeEvent(created, deps);
    await processDisputeEvent(created, deps);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("records the ledger withdrawal on funds_withdrawn and the reversal on funds_reinstated", async () => {
    const { store, events } = makeStore({ pi_1: order });
    const { deps, withdraw, reinstate, notify } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", {}), deps);
    await processDisputeEvent(ev("charge.dispute.funds_withdrawn", "evt_2", {
      balance_transactions: [{ amount: -4200, fee: 1500 }],
    }), deps);
    expect(withdraw).toHaveBeenCalledWith(expect.objectContaining({
      stripeDisputeId: "dp_1", stripeEventId: "evt_2", orderId: "o1", amountCents: 4200,
    }));
    expect(events.find((e) => e.kind === "funds_withdrawn")!.payload.feeCents).toBe(1500);

    await processDisputeEvent(ev("charge.dispute.funds_reinstated", "evt_3", { status: "won" }), deps);
    expect(reinstate).toHaveBeenCalledWith(expect.objectContaining({ stripeDisputeId: "dp_1" }));
    // withdrawn / reinstated alone never notify.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies on won and lost, and a late update never reopens a finished dispute", async () => {
    const { store, disputes } = makeStore({ pi_1: order });
    const { deps, notify } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", {}, 1000), deps);
    await processDisputeEvent(ev("charge.dispute.closed", "evt_2", { status: "lost" }, 3000), deps);
    expect(disputes.get("dp_1")!.status).toBe("lost");
    await processDisputeEvent(ev("charge.dispute.updated", "evt_3", { status: "under_review" }, 2000), deps);
    expect(disputes.get("dp_1")!.status).toBe("lost");
    const types = notify.mock.calls.map((c) => (c as any)[0].type);
    expect(types).toEqual(["dispute_created", "dispute_lost"]);
    expect((notify.mock.calls[1] as any)[0].body).toContain("went back to the customer");
  });

  it("ignores a stale status update but still records it on the timeline", async () => {
    const { store, disputes, events } = makeStore({ pi_1: order });
    const { deps } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", {}, 1000), deps);
    await processDisputeEvent(ev("charge.dispute.updated", "evt_3", { status: "under_review" }, 3000), deps);
    await processDisputeEvent(ev("charge.dispute.updated", "evt_2", { status: "needs_response" }, 2000), deps);
    expect(disputes.get("dp_1")!.status).toBe("under_review");
    expect(events).toHaveLength(3);
  });

  it("marks the first move to under_review as a submission, later updates as updates", async () => {
    const { store, events } = makeStore({ pi_1: order });
    const { deps } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", {}, 1000), deps);
    await processDisputeEvent(ev("charge.dispute.updated", "evt_2", { status: "under_review" }, 2000), deps);
    await processDisputeEvent(ev("charge.dispute.updated", "evt_3", { status: "under_review" }, 3000), deps);
    expect(events.map((e) => e.kind)).toEqual(["created", "evidence_submitted", "updated"]);
  });

  it("handles a dispute for an unknown seller without notifying or posting to the ledger", async () => {
    const { store, disputes, events } = makeStore({});
    const { deps, notify, withdraw } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", {}), deps);
    await processDisputeEvent(ev("charge.dispute.funds_withdrawn", "evt_2", {}), deps);
    expect(disputes.get("dp_1")!.sellerId).toBe("unknown");
    expect(events.map((e) => e.kind)).toEqual(["created", "funds_withdrawn"]);
    expect(notify).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("creates the dispute when updated arrives before created", async () => {
    const { store, disputes } = makeStore({ pi_1: order });
    const { deps } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.updated", "evt_2", { status: "under_review" }, 2000), deps);
    expect(disputes.get("dp_1")!.status).toBe("under_review");
  });

  it("uses inquiry wording for warning_needs_response", async () => {
    const { store } = makeStore({ pi_1: order });
    const { deps, notify } = makeDeps(store);
    await processDisputeEvent(ev("charge.dispute.created", "evt_1", { status: "warning_needs_response" }), deps);
    expect((notify.mock.calls[0] as any)[0].title).toBe("Payment inquiry for $42.00");
  });

  it("ignores unrelated event types and sums dispute fees", async () => {
    const { store } = makeStore();
    const { deps } = makeDeps(store);
    expect(await processDisputeEvent(ev("charge.refunded", "evt_x", {}), deps)).toEqual({ handled: false, duplicate: false });
    expect(disputeFeeCents({ balance_transactions: [{ fee: 1500 }, { fee: 0 }] })).toBe(1500);
    expect(disputeFeeCents({})).toBeNull();
  });
});
