import { describe, expect, it } from "vitest";
import { mapPayoutOrders, payoutOrderLookupIds, type PayoutOrderRef, type PayoutTxnLike } from "./payoutOrders";

const order = (id: string, extra: Partial<PayoutOrderRef>, createdAt = "2026-10-01T12:00:00Z"): PayoutOrderRef => ({
  id, orderNumber: id.toUpperCase(), buyerName: null, stripeTransferId: null, stripeChargeId: null,
  stripePaymentIntentId: null, createdAt: new Date(createdAt), ...extra,
});

describe("mapPayoutOrders", () => {
  const txns: PayoutTxnLike[] = [
    // Destination/transfer order: py_ payment funded by the order's transfer.
    { type: "payment", amount: 4750, fee: 0, net: 4750, source: { id: "py_1", object: "charge", source_transfer: "tr_1" } },
    // Its partial refund references the py_ charge only.
    { type: "payment_refund", amount: -1000, fee: 0, net: -1000, source: { id: "pyr_1", object: "refund", charge: "py_1" } },
    // Direct charge by charge id.
    { type: "charge", amount: 2000, fee: 88, net: 1912, source: { id: "ch_2", object: "charge", payment_intent: "pi_2" } },
    // Matched by payment intent only (unexpanded transfer ref object form).
    { type: "charge", amount: 500, fee: 45, net: 455, source: { id: "ch_9", object: "charge", payment_intent: { id: "pi_3" } } },
    // Unrelated: Thread Cash top-up and a payout fee.
    { type: "payment", amount: 300, fee: 0, net: 300, source: { id: "py_x", source_transfer: "tr_unknown" } },
    { type: "stripe_fee", amount: -200, fee: 0, net: -200, source: null },
  ];
  const orders = [
    order("o1", { stripeTransferId: "tr_1", buyerName: "Sam Lee" }, "2026-10-01T10:00:00Z"),
    order("o2", { stripeChargeId: "ch_2", stripePaymentIntentId: "pi_2" }, "2026-10-02T10:00:00Z"),
    order("o3", { stripePaymentIntentId: "pi_3" }, "2026-09-30T10:00:00Z"),
  ];

  it("maps payments and their refunds to orders, newest first", () => {
    expect(mapPayoutOrders(txns, orders)).toEqual([
      { orderId: "o2", orderNumber: "O2", total: 2000, fee: 88, net: 1912, createdAt: "2026-10-02T10:00:00.000Z" },
      { orderId: "o1", orderNumber: "O1", buyerName: "Sam Lee", total: 3750, fee: 0, net: 3750, createdAt: "2026-10-01T10:00:00.000Z" },
      { orderId: "o3", orderNumber: "O3", total: 500, fee: 45, net: 455, createdAt: "2026-09-30T10:00:00.000Z" },
    ]);
  });

  it("collects every id worth looking orders up by", () => {
    expect(payoutOrderLookupIds(txns)).toEqual(expect.arrayContaining(["tr_1", "py_1", "ch_2", "pi_2", "pi_3", "tr_unknown"]));
  });

  it("returns nothing when no order matches or sources are unexpanded strings", () => {
    expect(mapPayoutOrders([{ type: "payment", amount: 1, fee: 0, net: 1, source: "py_9" }], orders)).toEqual([]);
    expect(mapPayoutOrders([], orders)).toEqual([]);
  });
});
