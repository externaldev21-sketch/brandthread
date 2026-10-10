import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/nativeEntitlements", () => ({ getEffectiveEntitlement: vi.fn() }));

import router from "../seller-plan-config";
import { PLAN_CATALOGUE } from "../../lib/planCatalogue";
import { platformFeeBpsForPlan } from "../../lib/planPerks";
import { MONTHLY_ALLOWANCE } from "../../lib/aiCredits/catalogue";

function call(): Record<string, any> {
  let body: any;
  const res = { set: vi.fn(), json: (b: unknown) => { body = b; } };
  const layer = (router as any).stack.find((l: any) => l.route?.path === "/");
  layer.route.stack[0].handle({}, res, () => {});
  return body;
}

describe("GET /api/config/seller-plans", () => {
  it("each plan card's numbers come from the modules that enforce them", () => {
    const body = call();
    for (const plan of body.plans) {
      expect(plan.limits.activeProducts).toBe(PLAN_CATALOGUE[plan.id as keyof typeof PLAN_CATALOGUE].limits.products);
      expect(plan.commissionPercent).toBe(platformFeeBpsForPlan(plan.id) / 100);
      const ai = MONTHLY_ALLOWANCE[plan.id as keyof typeof MONTHLY_ALLOWANCE];
      if (typeof ai === "number") expect(plan.limits.aiCreditsPerMonth).toBe(ai);
      else expect(plan.limits).not.toHaveProperty("aiCreditsPerMonth"); // never shown as "unlimited"
    }
  });

  it("is public and cacheable (no account data)", () => {
    const body = call();
    expect(Object.keys(body).sort()).toEqual(["checkoutMode", "currency", "plans", "reminderDaysBefore", "trialDays"]);
  });
});
