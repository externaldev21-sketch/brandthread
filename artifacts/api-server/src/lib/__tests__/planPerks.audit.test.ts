import { describe, expect, it } from "vitest";
import { PLAN_IDS } from "../planCatalogue";
import { PLAN_PERKS, buildPlanPerks, hasAdvancedAnalytics } from "../planPerks";

describe("PLAN_PERKS.advancedAnalytics (audit)", () => {
  it("matches the analytics tier the plan catalogue actually grants", () => {
    for (const planId of PLAN_IDS) {
      expect(PLAN_PERKS[planId].advancedAnalytics, planId).toBe(hasAdvancedAnalytics(planId));
    }
    expect(PLAN_PERKS.growth.advancedAnalytics).toBe(true);
    for (const perk of buildPlanPerks()) expect(perk.advancedAnalytics).toBe(PLAN_PERKS[perk.planId].advancedAnalytics);
  });
});
