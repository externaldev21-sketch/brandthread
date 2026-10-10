import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ planId: "starter" as string, fail: false }));

vi.mock("../nativeEntitlements", () => ({
  getEffectiveEntitlement: async () => {
    if (state.fail) throw new Error("database unavailable");
    return { planId: state.planId, status: "active", provider: "stripe", native: null };
  },
}));

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

beforeEach(() => {
  state.planId = "starter";
  state.fail = false;
});

describe("platformFeeBpsForPlan", () => {
  it("is 5% / 4% / 3% for starter / growth / pro", () => {
    expect(platformFeeBpsForPlan("starter")).toBe(500);
    expect(platformFeeBpsForPlan("growth")).toBe(400);
    expect(platformFeeBpsForPlan("pro")).toBe(300);
  });

  it("keeps Starter identical to the pre-plan standard rate", () => {
    expect(platformFeeBpsForPlan("starter")).toBe(PLATFORM_FEE_BPS);
  });

  it("falls back to the standard rate for unknown or missing plans", () => {
    for (const plan of [null, undefined, "", "scale", "free", "PRO"]) {
      expect(platformFeeBpsForPlan(plan)).toBe(DEFAULT_PLATFORM_FEE_BPS);
    }
  });
});

describe("resolveSellerPlatformFeeBps", () => {
  it("uses the seller's verified plan", async () => {
    state.planId = "pro";
    await expect(resolveSellerPlatformFeeBps("seller")).resolves.toBe(300);
    state.planId = "growth";
    await expect(resolveSellerPlatformFeeBps("seller")).resolves.toBe(400);
  });

  it("fails safe to the standard rate when the plan lookup throws", async () => {
    state.fail = true;
    await expect(resolveSellerPlatformFeeBps("seller")).resolves.toBe(500);
  });
});

describe("fee computation per plan (integer cents)", () => {
  it("computes the platform fee for $100.00 at each plan rate", () => {
    expect(platformFeeCents(10_000, platformFeeBpsForPlan("starter"))).toBe(500);
    expect(platformFeeCents(10_000, platformFeeBpsForPlan("growth"))).toBe(400);
    expect(platformFeeCents(10_000, platformFeeBpsForPlan("pro"))).toBe(300);
  });

  it("rounds half-up to whole cents", () => {
    // $10.10: 5% = 50.5c -> 51c, 4% = 40.4c -> 40c, 3% = 30.3c -> 30c
    expect(platformFeeCents(1010, 500)).toBe(51);
    expect(platformFeeCents(1010, 400)).toBe(40);
    expect(platformFeeCents(1010, 300)).toBe(30);
  });

  it("does not change the default: no rate given means 5%", () => {
    expect(platformFeeCents(12_345)).toBe(platformFeeCents(12_345, 500));
  });

  it("applies the plan rate to the destination application fee, processing unchanged", () => {
    const starter = destinationApplicationFeeCents({ merchandiseCents: 10_000, preTaxTotalCents: 11_000 });
    const pro = destinationApplicationFeeCents({ merchandiseCents: 10_000, preTaxTotalCents: 11_000, platformFeeBps: 300 });
    expect(starter.platformFeeCents).toBe(500);
    expect(pro.platformFeeCents).toBe(300);
    expect(pro.processingFeeEstimateCents).toBe(starter.processingFeeEstimateCents);
    expect(pro.applicationFeeCents).toBe(starter.applicationFeeCents - 200);
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
      expect(perk.platformFeeBps).toBe(platformFeeBpsForPlan(perk.planId));
    }
    expect(perks.find((p) => p.planId === "pro")).toMatchObject({
      amountCents: 19900, platformFeeBps: 300, monthlyAiCredits: null, unlimitedAiCredits: true, advancedAnalytics: true,
    });
  });

  it("carries each plan's product cap and team seats from the plan catalogue", () => {
    const perks = buildPlanPerks();
    for (const perk of perks) {
      expect(perk.productLimit).toBe(PLAN_CATALOGUE[perk.planId].limits.products);
      expect(perk.teamSeats).toBe(PLAN_CATALOGUE[perk.planId].limits.teamSeats);
    }
    expect(perks.find((p) => p.planId === "starter")).toMatchObject({ productLimit: 25, teamSeats: 0 });
    expect(perks.find((p) => p.planId === "pro")).toMatchObject({ productLimit: null, teamSeats: null });
  });

  it("only Pro has advanced analytics", () => {
    expect(hasAdvancedAnalytics("pro")).toBe(true);
    expect(hasAdvancedAnalytics("growth")).toBe(false);
    expect(hasAdvancedAnalytics("starter")).toBe(false);
    expect(hasAdvancedAnalytics(null)).toBe(false);
  });
});
