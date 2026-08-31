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

import { getVerifiedPlanAccess, sendPlanLimitReached } from "../planAccess";

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
    });
  });

  it("returns Growth's three team seats and unlimited products", async () => {
    state.planId = "growth";
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "growth",
      limits: { products: null, teamSeats: 3 },
    });
  });

  it("uses a resolved native Pro entitlement for the highest tier limits", async () => {
    state.planId = "pro";
    state.provider = "revenuecat";
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "pro",
      limits: { products: null, teamSeats: null },
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
});