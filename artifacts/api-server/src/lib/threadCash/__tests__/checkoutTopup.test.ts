import { describe, expect, it, vi } from "vitest";

// topupDue is pure; the module's database imports are never reached here.
vi.mock("@workspace/db", () => ({ db: {}, orders: {}, users: {} }));
vi.mock("../../money/ledger", () => ({ postLedgerTransaction: async () => {} }));

const { topupDue } = await import("../checkoutTopup");

const order = (patch: Partial<Parameters<typeof topupDue>[0]>) => ({
  chargeModel: "destination", fundsState: "settled_direct", threadCashAppliedCents: 500, stripeThreadCashTransferId: null, ...patch,
});

describe("Thread Cash seller top-up timing (BT-258 / BT-270)", () => {
  it("tops up a destination order right away", () => {
    expect(topupDue(order({}))).toBe(true);
  });

  it("waits for a transfer (in-app) order's own payout", () => {
    expect(topupDue(order({ chargeModel: "transfer", fundsState: "held" }))).toBe(false);
    expect(topupDue(order({ chargeModel: "transfer", fundsState: "released" }))).toBe(true);
  });

  it("waits for a preorder's release when it ships", () => {
    expect(topupDue(order({ chargeModel: "held", fundsState: "held" }))).toBe(false);
    expect(topupDue(order({ chargeModel: "held", fundsState: "release_pending" }))).toBe(false);
    expect(topupDue(order({ chargeModel: "held", fundsState: "released" }))).toBe(true);
  });

  it("never tops up twice, nor an order without Thread Cash", () => {
    expect(topupDue(order({ stripeThreadCashTransferId: "tr_1" }))).toBe(false);
    expect(topupDue(order({ threadCashAppliedCents: 0 }))).toBe(false);
    expect(topupDue(order({ threadCashAppliedCents: null }))).toBe(false);
    expect(topupDue(order({ chargeModel: "transfer", fundsState: "refunded" }))).toBe(false);
  });
});
