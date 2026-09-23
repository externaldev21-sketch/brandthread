import { describe, expect, it } from "vitest";
import {
  dropEscrowMachine, IllegalTransitionError, orderFundsMachine, orderStatusMachine, refundMachine,
  releaseMachine, type StateMachine,
} from "../stateMachines";
import { normalizePostings } from "../ledger";
import { MoneyError } from "../fees";

/** Every (from, to) pair, so a newly added edge must be listed here on purpose. */
function allowedPairs<S extends string>(machine: StateMachine<S>): string[] {
  const pairs: string[] = [];
  for (const from of machine.states) {
    for (const to of machine.states) if (machine.can(from, to)) pairs.push(`${from}->${to}`);
  }
  return pairs.sort();
}

describe("order funds state machine", () => {
  it("allows exactly the documented transitions", () => {
    expect(allowedPairs(orderFundsMachine)).toEqual([
      "held->refunded",
      "held->release_pending",
      "refunded->held",
      "refunded->released",
      "refunded->settled_direct",
      "release_pending->held",
      "release_pending->released",
      "released->refunded",
      "settled_direct->refunded",
    ]);
  });

  it("refuses to release a refunded or in-stock order", () => {
    expect(() => orderFundsMachine.assert("refunded", "release_pending")).toThrow(IllegalTransitionError);
    expect(() => orderFundsMachine.assert("settled_direct", "release_pending")).toThrow(IllegalTransitionError);
    expect(() => orderFundsMachine.assert("released", "release_pending")).toThrow(IllegalTransitionError);
  });

  it("lists which states may enter a target", () => {
    expect(orderFundsMachine.sourcesOf("refunded").sort()).toEqual(["held", "released", "settled_direct"]);
  });
});

describe("drop escrow state machine", () => {
  it("allows exactly the documented transitions", () => {
    expect(allowedPairs(dropEscrowMachine)).toEqual([
      "collecting->completed",
      "collecting->failing",
      "collecting->fulfilling",
      "collecting->production",
      "failing->failed",
      "fulfilling->completed",
      "fulfilling->failing",
      "production->completed",
      "production->failing",
      "production->fulfilling",
    ]);
  });

  it("treats completed and failed as final", () => {
    expect([...dropEscrowMachine.terminal].sort()).toEqual(["completed", "failed"]);
    expect(dropEscrowMachine.can("failed", "collecting")).toBe(false);
    expect(dropEscrowMachine.can("completed", "failing")).toBe(false);
  });

  it("never goes backwards into collecting", () => {
    expect(dropEscrowMachine.sourcesOf("collecting")).toEqual([]);
  });
});

describe("release (payout) state machine", () => {
  it("allows exactly the documented transitions", () => {
    expect(allowedPairs(releaseMachine)).toEqual([
      "failed->transferring",
      "paid->reversed",
      "pending->transferring",
      "transferring->failed",
      "transferring->paid",
      "transferring->pending",
    ]);
  });

  it("cannot pay twice", () => {
    expect(releaseMachine.can("paid", "transferring")).toBe(false);
    expect(releaseMachine.can("paid", "paid")).toBe(false);
  });
});

describe("refund state machine", () => {
  it("allows exactly the documented transitions", () => {
    expect(allowedPairs(refundMachine)).toEqual([
      "failed->processing",
      "processing->failed",
      "processing->succeeded",
      "succeeded->failed",
    ]);
  });
});

describe("order status machine", () => {
  it("never lets a shipped order go back to pre-shipment", () => {
    for (const to of ["pending", "processing", "fulfilled", "label_purchasing", "refund_pending"] as const) {
      expect(orderStatusMachine.can("shipped", to)).toBe(false);
    }
  });

  it("makes cancelled final", () => {
    expect(orderStatusMachine.terminal).toContain("cancelled");
  });

  it("returns a failed refund to the pre-refund status", () => {
    expect(orderStatusMachine.can("refund_pending", "processing")).toBe(true);
    expect(orderStatusMachine.can("refund_pending", "shipped")).toBe(false);
  });

  it("rejects unknown states", () => {
    expect(orderStatusMachine.isState("teleported")).toBe(false);
    expect(() => orderStatusMachine.assert("teleported" as never, "shipped")).toThrow(IllegalTransitionError);
  });
});

describe("ledger posting validation", () => {
  it("accepts balanced postings and drops zero lines", () => {
    expect(normalizePostings([
      { account: "buyer_payments", amountCents: -100 },
      { account: "seller_held", amountCents: 95 },
      { account: "platform_revenue", amountCents: 5 },
      { account: "processing_fee_variance", amountCents: 0 },
    ])).toHaveLength(3);
  });

  it("rejects unbalanced, fractional, single-sided and unknown postings", () => {
    expect(() => normalizePostings([
      { account: "buyer_payments", amountCents: -100 },
      { account: "seller_held", amountCents: 99 },
    ])).toThrow(MoneyError);
    expect(() => normalizePostings([
      { account: "buyer_payments", amountCents: -0.5 },
      { account: "seller_held", amountCents: 0.5 },
    ])).toThrow(MoneyError);
    expect(normalizePostings([
      { account: "buyer_payments", amountCents: 0 },
      { account: "seller_held", amountCents: 0 },
    ])).toEqual([]);
    expect(() => normalizePostings([
      { account: "nowhere" as never, amountCents: -1 },
      { account: "seller_held", amountCents: 1 },
    ])).toThrow(MoneyError);
  });
});
