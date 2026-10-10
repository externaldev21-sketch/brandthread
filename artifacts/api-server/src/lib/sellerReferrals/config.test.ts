import { describe, expect, it } from "vitest";
import { creditCents, isSellerAccount, monthlyEquivalentCents, sellerReferralConfig } from "./config";

describe("seller referral config (BT-313)", () => {
  it("is off unless switched on, with clamped settings", () => {
    expect(sellerReferralConfig({}).enabled).toBe(false);
    expect(sellerReferralConfig({ SELLER_REFERRAL_ENABLED: "1" }).enabled).toBe(false);
    const cfg = sellerReferralConfig({ SELLER_REFERRAL_ENABLED: "TRUE", SELLER_REFERRAL_FREE_MONTHS: "9", SELLER_REFERRAL_MAX_REWARDS_PER_SELLER: "x" });
    expect(cfg).toEqual({ enabled: true, freeMonths: 3, maxRewardsPerSeller: 12, maxCreditCents: 50_000, applyWindowDays: 30 });
  });

  it("turns any billing interval into a monthly price", () => {
    expect(monthlyEquivalentCents({ unit_amount: 2900, recurring: { interval: "month" } })).toBe(2900);
    expect(monthlyEquivalentCents({ unit_amount: 29000, recurring: { interval: "year" } })).toBe(2417);
    expect(monthlyEquivalentCents({ unit_amount: 6000, recurring: { interval: "month", interval_count: 3 } })).toBe(2000);
    expect(monthlyEquivalentCents({ unit_amount: null, recurring: { interval: "month" } })).toBe(0);
    expect(monthlyEquivalentCents({ unit_amount: 2900, recurring: null })).toBe(0);
  });

  it("credits N months, never above the ceiling", () => {
    expect(creditCents(7900, { freeMonths: 1, maxCreditCents: 50_000 })).toBe(7900);
    expect(creditCents(19900, { freeMonths: 3, maxCreditCents: 50_000 })).toBe(50_000);
    expect(creditCents(0, { freeMonths: 1, maxCreditCents: 50_000 })).toBe(0);
  });

  it("treats seller and both as brands", () => {
    expect(isSellerAccount("seller")).toBe(true);
    expect(isSellerAccount("both")).toBe(true);
    expect(isSellerAccount("buyer")).toBe(false);
    expect(isSellerAccount(null)).toBe(false);
  });
});
