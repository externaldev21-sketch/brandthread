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

import { getVerifiedPlanAccess, nextPlanFor, planLimitMessage, sendPlanLimitReached } from "../planAccess";
import { NO_PLAN_LIMITS, PLAN_CATALOGUE } from "../planCatalogue";

describe("plan access catalogue", () => {
  beforeEach(() => {
    state.planId = "starter";
    state.provider = "stripe";
    state.unavailable = false;
  });

  it("returns the current Starter product and team allowances", async () => {
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "starter",
      limits: PLAN_CATALOGUE.starter.limits,
      paid: true,
    });
  });

  it("returns Growth's three team seats and unlimited products", async () => {
    state.planId = "growth";
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "growth",
      limits: PLAN_CATALOGUE.growth.limits,
      paid: true,
    });
  });

  it("uses a resolved native Pro entitlement for the highest tier limits", async () => {
    state.planId = "pro";
    state.provider = "revenuecat";
    await expect(getVerifiedPlanAccess("owner")).resolves.toEqual({
      planId: "pro",
      limits: PLAN_CATALOGUE.pro.limits,
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

  it("a seller with no live trial or plan can't publish or sell (Dev's trial decision)", async () => {
    state.provider = "none";
    const access = await getVerifiedPlanAccess("owner");
    expect(access).toEqual({ planId: "starter", limits: NO_PLAN_LIMITS, paid: false });
    expect(NO_PLAN_LIMITS.products).toBe(0);
    expect(nextPlanFor(access)).toBe("starter");
  });

  it("names the next plan that actually raises the limit", () => {
    expect(nextPlanFor({ planId: "starter", paid: true })).toBe("growth");
    expect(nextPlanFor({ planId: "growth", paid: true })).toBe("pro");
    expect(nextPlanFor({ planId: "pro", paid: true })).toBeNull();
    expect(nextPlanFor({ planId: "starter", paid: true }, "teamSeats")).toBe("growth");
  });

  it("uses Dev's exact cap-hit copy with the counts the upgrade sheet needs", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    sendPlanLimitReached({ status, json } as any, {
      resource: "products", currentPlan: "starter", requiredPlan: "growth", limit: 10, paid: true,
    });
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: "PLAN_LIMIT_REACHED",
      currentPlan: "starter",
      requiredPlan: "growth",
      used: 10,
      limit: 10,
      nextLimit: PLAN_CATALOGUE.growth.limits.products,
      message: "You've listed 10 of 10 products on Starter. Upgrade to Growth to list up to 50.",
    }));
    expect(planLimitMessage({ resource: "products", planId: "growth", paid: true, used: 50, limit: 50, nextPlan: "pro" }))
      .toBe("You've listed 50 of 50 products on Growth. Upgrade to Pro to list unlimited products.");
  });

  it("tells a seller without a plan to pick one", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    sendPlanLimitReached({ status, json } as any, { resource: "products", currentPlan: "starter", limit: 0, paid: false });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      currentPlan: "none",
      requiredPlan: "starter",
      message: "Pick a plan to start selling.",
    }));
  });
});
