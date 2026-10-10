import { describe, expect, it } from "vitest";

import { creditPolicyForPlan } from "../aiCredits/catalogue";
import { PLATFORM_FEE_BPS, destinationApplicationFeeCents, platformFeeCents, splitOrder } from "../money/fees";
import { PLAN_CATALOGUE } from "../planCatalogue";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  buildPlanPerks,
  hasAdvancedAnalytics,
  platformFeeBpsForPlan,
  resolveSellerPlatformFeeBps,
} from "../planPerks";

describe("platformFeeBpsForPlan", () => {
  it("is a flat 5% on starter, growth and pro (owner's rule, BT-058)", () => {
    expect(platformFeeBpsForPlan("starter")).toBe(500);
    expect(platformFeeBpsForPlan("growth")).toBe(500);
    expect(platformFeeBpsForPlan("pro")).toBe(500);
  });

  it("comes from PLATFORM_FEE_BPS, the single source", () => {
    for (const plan of ["starter", "growth", "pro"]) {
      expect(platformFeeBpsForPlan(plan)).toBe(PLATFORM_FEE_BPS);
    }
  });

  it("falls back to the standard rate for unknown or missing plans", () => {
    for (const plan of [null, undefined, "", "scale", "free", "PRO"]) {
      expect(platformFeeBpsForPlan(plan)).toBe(DEFAULT_PLATFORM_FEE_BPS);
    }
  });
});

describe("resolveSellerPlatformFeeBps", () => {
  it("charges 5% to every seller whatever their plan or status (trial, past due, grace)", async () => {
    await expect(resolveSellerPlatformFeeBps("pro-trial-seller")).resolves.toBe(500);
    await expect(resolveSellerPlatformFeeBps("growth-past-due-seller")).resolves.toBe(500);
    await expect(resolveSellerPlatformFeeBps("starter-seller")).resolves.toBe(500);
  });
});

describe("fee computation (integer cents)", () => {
  it("computes the platform fee for $100.00 at 5% on every plan", () => {
    for (const plan of ["starter", "growth", "pro"]) {
      expect(platformFeeCents(10_000, platformFeeBpsForPlan(plan))).toBe(500);
    }
  });

  it("rounds half-up to whole cents", () => {
    // $10.10: 5% = 50.5c -> 51c
    expect(platformFeeCents(1010, 500)).toBe(51);
  });

  it("does not change the default: no rate given means 5%", () => {
    expect(platformFeeCents(12_345)).toBe(platformFeeCents(12_345, 500));
  });

  it("the destination application fee is the same on every plan", () => {
    const starter = destinationApplicationFeeCents({ merchandiseCents: 10_000, shippingCents: 1_000, preTaxTotalCents: 11_000 });
    const pro = destinationApplicationFeeCents({
      merchandiseCents: 10_000, shippingCents: 1_000, preTaxTotalCents: 11_000, platformFeeBps: platformFeeBpsForPlan("pro"),
    });
    expect(pro).toEqual(starter);
    expect(pro.platformFeeCents).toBe(550);
  });

  it("splitOrder uses the rate fixed at checkout and null means 5%", () => {
    const base = { subtotalCents: 10_000, discountCents: 0, shippingCents: 0, taxCents: 0, grossCents: 10_000, processingFeeCents: 320 };
    expect(splitOrder({ ...base, platformFeeBps: 300 }).platformFeeCents).toBe(300);
    expect(splitOrder({ ...base, platformFeeBps: 300 }).sellerNetCents).toBe(10_000 - 300 - 320);
    expect(splitOrder({ ...base, platformFeeBps: null }).platformFeeCents).toBe(500);
    expect(splitOrder(base).platformFeeCents).toBe(500);
  });
});

describe("buildPlanPerks", () => {
  it("is built from the plan catalogue, fee config and AI allowance", () => {
    const perks = buildPlanPerks();
    expect(perks.map((p) => p.planId)).toEqual(["starter", "growth", "pro"]);
    for (const perk of perks) {
      expect(perk.amountCents).toBe(PLAN_CATALOGUE[perk.planId].amountCents);
      expect(perk.monthlyAiCredits).toBe(creditPolicyForPlan(perk.planId).monthlyAllowance);
      expect(perk.platformFeeBps).toBe(PLATFORM_FEE_BPS);
    }
    expect(perks.find((p) => p.planId === "pro")).toMatchObject({
      amountCents: PLAN_CATALOGUE.pro.amountCents, advancedAnalytics: true,
    });
  });

  it("only Pro has advanced analytics", () => {
    expect(hasAdvancedAnalytics("pro")).toBe(true);
    expect(hasAdvancedAnalytics("growth")).toBe(false);
    expect(hasAdvancedAnalytics("starter")).toBe(false);
    expect(hasAdvancedAnalytics(null)).toBe(false);
  });
});
