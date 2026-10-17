import { describe, expect, it } from "vitest";
import { deriveSetupTasks, orderSetupTasks, sanitizeSetupState, normalizeOnboardingGoals, SETUP_TASK_IDS } from "./sellerSetupChecklist";

const base = {
  accountType: "seller", onboardingComplete: true, stripeAccountStatus: null, productCount: 0,
  shippingConfigured: false, logoUrl: null, verifiedDomain: false, storePublished: false, postCount: 0,
};

describe("deriveSetupTasks", () => {
  it("marks payments done only when Stripe Connect is active", () => {
    expect(deriveSetupTasks({ ...base, stripeAccountStatus: "pending" }).connect_payments).toBe(false);
    expect(deriveSetupTasks({ ...base, stripeAccountStatus: "active" }).connect_payments).toBe(true);
  });
  it("derives products, logo, publish, posts and shipping from real data", () => {
    const d = deriveSetupTasks({ ...base, productCount: 2, logoUrl: "/objects/x", storePublished: true, postCount: 1, shippingConfigured: true, verifiedDomain: true });
    expect(d).toMatchObject({ first_product: true, customize_store: true, publish_store: true, first_post: true, shipping_rates: true, connect_domain: true, verify_account: true });
    expect(deriveSetupTasks({ ...base, accountType: "buyer" }).verify_account).toBe(false);
  });
});

describe("sanitizeSetupState", () => {
  it("drops manual completion on derived tasks but keeps skips and manual-only tasks", () => {
    const s = sanitizeSetupState({
      started: true,
      tasks: { connect_payments: { completed: true }, first_post: { skipped: true }, connect_manufacturer: { completed: true }, bogus: { completed: true } },
      dismissedTips: ["a", 3],
    });
    expect(s.tasks.connect_payments).toBeUndefined();
    expect(s.tasks.first_post).toEqual({ skipped: true });
    expect(s.tasks.connect_manufacturer).toEqual({ completed: true });
    expect(s.dismissedTips).toEqual(["a"]);
    expect(s.started).toBe(true);
  });
});

describe("orderSetupTasks", () => {
  it("keeps account first and pulls goal-related tasks forward", () => {
    const order = orderSetupTasks(["Build content", "Ship orders"]);
    expect(order.slice(0, 3)).toEqual(["verify_account", "first_post", "shipping_rates"]);
    expect([...order].sort()).toEqual([...SETUP_TASK_IDS].sort());
  });
  it("is the default order with no goals", () => {
    expect(orderSetupTasks([])).toEqual([...SETUP_TASK_IDS]);
  });
  it("normalises goals", () => {
    expect(normalizeOnboardingGoals([" A ", "A", 1, ""])).toEqual(["A"]);
    expect(normalizeOnboardingGoals("x")).toEqual([]);
  });
});
