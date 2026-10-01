import { describe, expect, it } from "vitest";
import {
  commissionBaseCents, commissionEligibleAt, computeCommissionCents, effectiveBps, isAttributionActive, isSelfReferral,
  normalizeAffiliateCode, owedCents, percentToBps, planPayout, statusAfterChange, totalReversalCents,
} from "../commission";

describe("commission math", () => {
  it("rounds down to whole cents: 10% of $19.99 is 199c", () => {
    expect(computeCommissionCents(1999, 1000)).toBe(199);
    expect(computeCommissionCents(1, 1000)).toBe(0);
    expect(computeCommissionCents(10_000, 1250)).toBe(1250);
    expect(computeCommissionCents(3333, 3333)).toBe(1110); // 1110.8889 floors
  });
  it("never produces negatives or NaN for bad input", () => {
    expect(computeCommissionCents(-5, 1000)).toBe(0);
    expect(computeCommissionCents(1000, 0)).toBe(0);
    expect(computeCommissionCents(1.5, 1000)).toBe(0);
  });
  it("base is the item subtotal minus seller discounts, never below zero", () => {
    expect(commissionBaseCents({ subtotalCents: 10_000, sellerDiscountCents: 1_000 })).toBe(9_000);
    expect(commissionBaseCents({ subtotalCents: 500, sellerDiscountCents: 900 })).toBe(0);
  });
  it("per-creator override beats the program default", () => {
    expect(effectiveBps(1000, null)).toBe(1000);
    expect(effectiveBps(1000, 1500)).toBe(1500);
    expect(effectiveBps(1000, 0)).toBe(0);
  });
  it("percent input converts to bps", () => {
    expect(percentToBps(12.5)).toBe(1250);
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps(-1)).toBeNull();
    expect(percentToBps("abc")).toBeNull();
  });
});

describe("attribution window", () => {
  const clicked = new Date("2026-01-01T00:00:00Z");
  it("counts inside the window and not after it", () => {
    expect(isAttributionActive({ clickedAt: clicked, windowDays: 30, at: new Date("2026-01-31T00:00:00Z") })).toBe(true);
    expect(isAttributionActive({ clickedAt: clicked, windowDays: 30, at: new Date("2026-01-31T00:00:01Z") })).toBe(false);
    expect(isAttributionActive({ clickedAt: clicked, windowDays: 30, at: new Date("2025-12-31T00:00:00Z") })).toBe(false);
  });
});

describe("self-referral", () => {
  it("blocks buyer == creator, creator == seller and matching guest email", () => {
    expect(isSelfReferral({ creatorId: "c", sellerId: "s", buyerId: "c" })).toBe(true);
    expect(isSelfReferral({ creatorId: "s", sellerId: "s", buyerId: "b" })).toBe(true);
    expect(isSelfReferral({ creatorId: "c", sellerId: "s", buyerId: null, creatorEmail: "A@x.com", buyerEmail: "a@X.com" })).toBe(true);
    expect(isSelfReferral({ creatorId: "c", sellerId: "s", buyerId: "b", creatorEmail: "a@x.com", buyerEmail: "b@x.com" })).toBe(false);
  });
});

describe("reversal on refund", () => {
  it("full refund or cancellation reverses everything", () => {
    expect(totalReversalCents({ amountCents: 500, grossCents: 6000, refundedCents: 6000, cancelled: false })).toBe(500);
    expect(totalReversalCents({ amountCents: 500, grossCents: 6000, refundedCents: 0, cancelled: true })).toBe(500);
  });
  it("partial refund reverses proportionally, keeping the floor of the rest", () => {
    // kept = floor(500 * 4500 / 6000) = 375, reversed 125
    expect(totalReversalCents({ amountCents: 500, grossCents: 6000, refundedCents: 1500, cancelled: false })).toBe(125);
    expect(totalReversalCents({ amountCents: 199, grossCents: 1999, refundedCents: 1, cancelled: false })).toBe(1);
  });
  it("is monotonic so it can be replayed", () => {
    const a = totalReversalCents({ amountCents: 500, grossCents: 6000, refundedCents: 1500, cancelled: false });
    const b = totalReversalCents({ amountCents: 500, grossCents: 6000, refundedCents: 1500, cancelled: false });
    expect(a).toBe(b);
  });
});

describe("eligibility", () => {
  it("only becomes eligible after delivery + hold days", () => {
    expect(commissionEligibleAt({ deliveredAt: null, holdDays: 30 })).toBeNull();
    const at = commissionEligibleAt({ deliveredAt: new Date("2026-01-01T00:00:00Z"), holdDays: 30 })!;
    expect(at.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
  it("derives status from the ledger numbers", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const base = { amountCents: 500, reversedCents: 0, paidCents: 0, now };
    expect(statusAfterChange({ ...base, eligibleAt: null })).toBe("pending");
    expect(statusAfterChange({ ...base, eligibleAt: new Date("2026-02-01T00:00:00Z") })).toBe("payable");
    expect(statusAfterChange({ ...base, eligibleAt: new Date("2026-04-01T00:00:00Z") })).toBe("pending");
    expect(statusAfterChange({ ...base, paidCents: 500, eligibleAt: null })).toBe("paid");
    expect(statusAfterChange({ ...base, reversedCents: 500, eligibleAt: null })).toBe("reversed");
  });
  it("owed is net entitlement minus paid, negative when a paid commission was reversed", () => {
    expect(owedCents({ amountCents: 500, reversedCents: 100, paidCents: 0 })).toBe(400);
    expect(owedCents({ amountCents: 500, reversedCents: 500, paidCents: 500 })).toBe(-500);
  });
  it("plans a payout only above the minimum with a ready account, netting clawbacks", () => {
    const rows = [
      { commissionId: "a", owed: 3000, status: "payable" as const },
      { commissionId: "b", owed: -500, status: "paid" as const },
      { commissionId: "c", owed: 900, status: "pending" as const },
    ];
    const ok = planPayout({ rows, minPayoutCents: 2500, accountReady: true, payoutsAvailable: true });
    expect(ok).toMatchObject({ eligible: true, amountCents: 2500, reason: "ok" });
    expect(ok.rows.map((r) => r.commissionId)).toEqual(["a", "b"]);
    expect(planPayout({ rows, minPayoutCents: 2501, accountReady: true, payoutsAvailable: true }).reason).toBe("below_minimum");
    expect(planPayout({ rows, minPayoutCents: 100, accountReady: false, payoutsAvailable: true }).reason).toBe("no_account");
    expect(planPayout({ rows, minPayoutCents: 100, accountReady: true, payoutsAvailable: false }).reason).toBe("unavailable");
    expect(planPayout({ rows: [], minPayoutCents: 100, accountReady: true, payoutsAvailable: true }).reason).toBe("nothing_owed");
  });
});

describe("codes", () => {
  it("normalizes and validates", () => {
    expect(normalizeAffiliateCode(" maya10 ")).toBe("MAYA10");
    expect(normalizeAffiliateCode("a")).toBeNull();
    expect(normalizeAffiliateCode("bad code!")).toBeNull();
    expect(normalizeAffiliateCode(5)).toBeNull();
  });
});
