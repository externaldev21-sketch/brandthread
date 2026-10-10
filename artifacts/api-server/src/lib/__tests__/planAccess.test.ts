import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  planId: "starter" as "starter" | "growth" | "pro",
  provider: "stripe" as "stripe" | "revenuecat" | "none",
  unavailable: false,
}));

vi.mock("../nativeEntitlements", () => ({
  getEffectiveEntitlement: async () => {
    if (state.unavailable) throw new Error("unavailable");
    return { planId: state.planId, status: "active", provider: state.provider, native: null };
  },
}));

import { getVerifiedPlanAccess, nextPlanFor, sendPlanLimitReached } from "../planAccess";
import { FREE_TIER_LIMITS } from "../planCatalogue";

describe("plan access catalogue", () => {
  beforeEach(() => {
    state.planId = "starter";
    state.provider = "stripe";
    state.unavailable = false;
  });

  it("returns the current Starter product and team allowances", async () => {
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "starter",
      limits: { products: 25, teamSeats: 0 },
      paid: true,
    });
  });

  it("returns Growth's three team seats and unlimited products", async () => {
    state.planId = "growth";
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "growth",
      limits: { products: null, teamSeats: 3 },
      paid: true,
    });
  });

  it("uses a resolved native Pro entitlement for the highest tier limits", async () => {
    state.planId = "pro";
    state.provider = "revenuecat";
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "pro",
      limits: { products: null, teamSeats: null },
      paid: true,
    });
  });

  it("fails closed when entitlement data is unavailable", async () => {
    state.unavailable = true;
    await expect(getVerifiedPlanAccess("owner")).rejects.toThrow("unavailable");
  });

  it("uses the upgrade response contract for exhausted quotas", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    sendPlanLimitReached({ status, json } as any, {
      resource: "products",
      currentPlan: "starter",
      requiredPlan: "growth",
      limit: 25,
    });
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: "PLAN_LIMIT_REACHED",
      currentPlan: "starter",
      requiredPlan: "growth",
      limit: 25,
    }));
  });

  it("applies the free-tier limits to a seller with no paid access (BT-002)", async () => {
    state.provider = "none";
    const access = await getVerifiedPlanAccess("owner");
    expect(access).toEqual({ planId: "starter", limits: FREE_TIER_LIMITS, paid: false });
    expect(nextPlanFor(access)).toBe("starter");
    expect(nextPlanFor({ planId: "starter", paid: true })).toBe("growth");
  });

  it("tells a free seller to start a plan, not to upgrade", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    sendPlanLimitReached({ status, json } as any, {
      resource: "products", currentPlan: "starter", requiredPlan: "growth", limit: 5, paid: false,
    });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      currentPlan: "free",
      requiredPlan: "starter",
      message: "Your free plan includes 5 products. Start a plan to add more.",
    }));
  });
});
