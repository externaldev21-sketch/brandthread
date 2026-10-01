import { describe, expect, it } from "vitest";
import { assertBreakdownReconciles, buildPayoutBreakdown, type BalanceTxnLike } from "../payoutBreakdown";
import {
  findInstantDestination, scheduleMatches, stripeScheduleParams, validateScheduleInput,
} from "../payoutSchedule";

const sale = (amount: number, app: number, stripe: number): BalanceTxnLike => ({
  type: "payment", reporting_category: "charge", amount, fee: app + stripe, net: amount - app - stripe,
  fee_details: [
    { type: "application_fee", amount: app },
    { type: "stripe_fee", amount: stripe },
  ],
});

describe("buildPayoutBreakdown", () => {
  it("groups sales, fees, refunds, disputes and reconciles to the payout", () => {
    const txns: BalanceTxnLike[] = [
      sale(10_000, 500, 320),
      sale(5_000, 250, 175),
      { type: "payment_refund", reporting_category: "refund", amount: -2_000, fee: 0, net: -2_000 },
      { type: "dispute", reporting_category: "dispute", amount: -3_000, fee: 1_500, net: -4_500 },
      { type: "reserve_transaction", reporting_category: "reserve_transaction", amount: -100, fee: 0, net: -100 },
      { type: "adjustment", reporting_category: "other_adjustment", amount: 40, fee: 0, net: 40 },
    ];
    const net = txns.reduce((s, t) => s + t.net, 0);
    const b = buildPayoutBreakdown({ payoutAmountCents: net, transactions: txns });
    expect(b.lines).toEqual({
      sales: 15_000, platformFee: -750, stripeFee: -495, refunds: -2_000, disputes: -4_500, holds: -100, adjustments: 40,
    });
    expect(b.reconciled).toBe(true);
    expect(b.remainderCents).toBe(0);
    expect(() => assertBreakdownReconciles(b)).not.toThrow();
  });

  it("shows an unexplained gap as adjustments instead of hiding it", () => {
    const b = buildPayoutBreakdown({ payoutAmountCents: 9_300, transactions: [sale(10_000, 500, 200)] });
    expect(b.remainderCents).toBe(0);
    const gap = buildPayoutBreakdown({ payoutAmountCents: 9_400, transactions: [sale(10_000, 500, 200)] });
    expect(gap.remainderCents).toBe(100);
    expect(gap.reconciled).toBe(false);
    expect(gap.lines.adjustments).toBe(100);
    expect(() => assertBreakdownReconciles(gap)).not.toThrow();
  });

  it("does not hide a fee that has no fee_details", () => {
    const b = buildPayoutBreakdown({
      payoutAmountCents: 9_000,
      transactions: [{ type: "charge", amount: 10_000, fee: 1_000, net: 9_000 }],
    });
    expect(b.lines.sales).toBe(10_000);
    expect(b.lines.adjustments).toBe(-1_000);
    expect(b.reconciled).toBe(true);
  });

  it("handles an empty transaction list", () => {
    const b = buildPayoutBreakdown({ payoutAmountCents: 500, transactions: [] });
    expect(b.lines.adjustments).toBe(500);
    expect(b.transactionCount).toBe(0);
  });

  it("rejects non-integer cents and detects a tampered breakdown", () => {
    expect(() => buildPayoutBreakdown({ payoutAmountCents: 1, transactions: [{ type: "charge", amount: 1.5, fee: 0, net: 1.5 }] })).toThrow();
    const b = buildPayoutBreakdown({ payoutAmountCents: 100, transactions: [] });
    expect(() => assertBreakdownReconciles({ ...b, lines: { ...b.lines, sales: 5 } })).toThrow();
  });
});

describe("validateScheduleInput", () => {
  it("accepts daily, manual and weekly with an anchor", () => {
    expect(validateScheduleInput({ interval: "daily" })).toEqual({ ok: true, update: { interval: "daily" } });
    expect(validateScheduleInput({ interval: "manual" })).toEqual({ ok: true, update: { interval: "manual" } });
    expect(validateScheduleInput({ interval: "weekly", weeklyAnchor: "friday" }))
      .toEqual({ ok: true, update: { interval: "weekly", weeklyAnchor: "friday" } });
  });

  it("rejects bad input", () => {
    for (const body of [null, "daily", {}, { interval: "hourly" }, { interval: "monthly" },
      { interval: "weekly" }, { interval: "weekly", weeklyAnchor: "someday" },
      { interval: "daily", weeklyAnchor: "monday" }]) {
      expect(validateScheduleInput(body).ok).toBe(false);
    }
  });

  it("scheduleMatches makes updates idempotent", () => {
    const cur = { interval: "weekly", weeklyAnchor: "friday", delayDays: 2, monthlyAnchor: null };
    expect(scheduleMatches(cur, { interval: "weekly", weeklyAnchor: "friday" })).toBe(true);
    expect(scheduleMatches(cur, { interval: "weekly", weeklyAnchor: "monday" })).toBe(false);
    expect(scheduleMatches(cur, { interval: "daily" })).toBe(false);
    expect(scheduleMatches(null, { interval: "daily" })).toBe(false);
    expect(stripeScheduleParams({ interval: "weekly", weeklyAnchor: "friday" })).toEqual({ interval: "weekly", weekly_anchor: "friday" });
    expect(stripeScheduleParams({ interval: "manual" })).toEqual({ interval: "manual" });
  });
});

describe("findInstantDestination", () => {
  const bank = { id: "ba_1", object: "bank_account", currency: "usd", default_for_currency: true, available_payout_methods: ["standard"], last4: "6789", bank_name: "Chase" };
  const card = { id: "card_1", object: "card", currency: "usd", brand: "Visa", funding: "debit", last4: "4242", available_payout_methods: ["standard", "instant"] };

  it("needs an instant-capable external account reported by Stripe", () => {
    expect(findInstantDestination([])).toEqual({ eligible: false, reason: "no_destination" });
    expect(findInstantDestination([bank])).toEqual({ eligible: false, reason: "not_instant_capable" });
    const r = findInstantDestination([bank, card]);
    expect(r).toEqual({ eligible: true, destination: { id: "card_1", brand: "Visa", last4: "4242", funding: "debit" } });
  });

  it("ignores errored or wrong-currency accounts", () => {
    expect(findInstantDestination([{ ...card, status: "errored" }]).eligible).toBe(false);
    expect(findInstantDestination([{ ...card, currency: "eur" }]).eligible).toBe(false);
  });
});
