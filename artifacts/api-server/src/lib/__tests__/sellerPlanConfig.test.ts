import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return {
    catalogue: await import("../planCatalogue"),
    config: await import("../sellerPlanConfig"),
  };
}

const KEYS = [
  "SELLER_TRIAL_DAYS", "SELLER_TRIAL_REMINDER_DAYS_BEFORE", "SELLER_CHECKOUT_MODE",
  "SELLER_PLAN_STARTER_CENTS", "SELLER_PLAN_GROWTH_CENTS", "SELLER_PLAN_PRO_CENTS",
  "SELLER_PLAN_STARTER_PRODUCTS", "SELLER_PLAN_GROWTH_PRODUCTS", "SELLER_PLAN_PRO_PRODUCTS",
];
afterEach(() => { for (const k of KEYS) delete process.env[k]; vi.resetModules(); });

describe("the one seller plan config", () => {
  it("defaults to Dev's tiers: $19.99 / $49 / $129, 10 / 50 / unlimited products, 1 / 3 / unlimited seats", async () => {
    const { catalogue: m, config } = await load({});
    expect(m.PLAN_CATALOGUE.starter.amountCents).toBe(1999);
    expect(m.PLAN_CATALOGUE.growth.amountCents).toBe(4900);
    expect(m.PLAN_CATALOGUE.pro.amountCents).toBe(12900);
    expect(m.PLAN_IDS.map((id) => m.PLAN_CATALOGUE[id].limits)).toEqual([
      { products: 10, teamSeats: 1 },
      { products: 50, teamSeats: 3 },
      { products: null, teamSeats: null },
    ]);
    const cfg = config.publicSellerPlanConfig();
    expect(cfg.plans.map((p) => [p.id, p.name, p.productLimit, p.staffSeats])).toEqual([
      ["starter", "Starter", 10, 1],
      ["growth", "Growth", 50, 3],
      ["pro", "Pro", null, null],
    ]);
    // The commission shown is the one checkout charges (lib/planPerks.ts).
    const { platformFeeBpsForPlan } = await import("../planPerks");
    for (const p of cfg.plans) expect(p.commissionPercent).toBe(platformFeeBpsForPlan(p.id) / 100);
  });

  it("tier gates follow Dev's spec", async () => {
    const { catalogue: m } = await load({});
    for (const key of ["liveSelling", "dropsEscrow", "boostFeatured", "customDomain", "manufacturerHub"] as const) {
      expect([m.planAllows("starter", key), m.planAllows("growth", key), m.planAllows("pro", key)], key).toEqual([false, true, true]);
    }
    expect(["starter", "growth", "pro"].map((id) => m.planFeature(id as "pro", "analytics"))).toEqual(["basic", "advanced", "full"]);
    expect(m.planAllows("pro", "analyticsExport")).toBe(true);
    expect(m.planAllows("growth", "analyticsExport")).toBe(false);
    expect(m.planAllows("pro", "prioritySupport")).toBe(true);
    expect(m.planAllows("growth", "prioritySupport")).toBe(false);
    expect(m.planFeature("starter", "emailSendsMonthly")).toBe(0);
    expect(m.planFeature("growth", "emailSendsMonthly")).toBeGreaterThan(0);
    expect(m.planFeature("pro", "emailSendsMonthly")).toBeGreaterThan(m.planFeature("growth", "emailSendsMonthly"));
    expect(m.planFeature("pro", "payoutSpeed")).toBe("faster");
    expect(m.planFeature("growth", "payoutSpeed")).toBe("standard");
  });

  it("keeps the trial at 7 days with the reminder 2 days before, and checkout as wired today", async () => {
    const { config } = await load({});
    const cfg = config.publicSellerPlanConfig();
    expect(cfg.trialDays).toBe(7);
    expect(cfg.reminderDaysBefore).toBe(2);
    expect(cfg.checkoutMode).toBe("auto");
    expect(cfg.currency).toBe("usd");
  });

  it("prices, caps and the trial come from env without a code change, and bad values fall back", async () => {
    const { catalogue: m, config } = await load({
      SELLER_TRIAL_DAYS: "14", SELLER_PLAN_GROWTH_CENTS: "6900", SELLER_CHECKOUT_MODE: "web",
      SELLER_PLAN_STARTER_PRODUCTS: "5", SELLER_PLAN_GROWTH_PRODUCTS: "15", SELLER_PLAN_PRO_PRODUCTS: "unlimited",
    });
    expect(m.TRIAL_DAYS).toBe(14);
    expect(m.PLAN_CATALOGUE.growth.amountCents).toBe(6900);
    expect(config.publicSellerPlanConfig().checkoutMode).toBe("web");
    expect(config.publicSellerPlanConfig().plans.map((p) => p.productLimit)).toEqual([5, 15, null]);

    const bad = await load({
      SELLER_TRIAL_DAYS: "-3", SELLER_PLAN_GROWTH_CENTS: "free", SELLER_CHECKOUT_MODE: "paypal",
      SELLER_PLAN_STARTER_PRODUCTS: "lots", SELLER_PLAN_GROWTH_PRODUCTS: "-1",
    });
    expect(bad.catalogue.TRIAL_DAYS).toBe(7);
    expect(bad.catalogue.PLAN_CATALOGUE.growth.amountCents).toBe(4900);
    expect(bad.catalogue.SELLER_CHECKOUT_MODE).toBe("auto");
    expect(bad.catalogue.PLAN_CATALOGUE.starter.limits.products).toBe(10);
    expect(bad.catalogue.PLAN_CATALOGUE.growth.limits.products).toBe(50);
  });

  it("the reminder always lands inside the trial", async () => {
    const { catalogue: m } = await load({ SELLER_TRIAL_DAYS: "2", SELLER_TRIAL_REMINDER_DAYS_BEFORE: "5" });
    expect(m.TRIAL_REMINDER_DAYS_BEFORE).toBe(1);
  });

  it("the cheapest plan for a product count", async () => {
    const { catalogue: m } = await load({});
    expect(m.planForProductCount(3)).toBe("starter");
    expect(m.planForProductCount(10)).toBe("growth");
    expect(m.planForProductCount(500)).toBe("pro");
  });

  it("Stripe Checkout uses the shared trial length", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(new URL("../../routes/subscription.ts", import.meta.url), "utf8");
    expect(route).toContain("trial_period_days: TRIAL_DAYS }");
    expect(route).not.toContain("trial_period_days: 5");
  });
});
