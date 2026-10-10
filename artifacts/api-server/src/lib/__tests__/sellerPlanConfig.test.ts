import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return import("../planCatalogue");
}

const KEYS = ["SELLER_TRIAL_DAYS", "SELLER_TRIAL_REMINDER_DAYS_BEFORE", "SELLER_CHECKOUT_MODE", "SELLER_PLAN_GROWTH_CENTS"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; vi.resetModules(); });

describe("shared seller plan config", () => {
  it("defaults to Dev's decision: 7-day trial, reminder 2 days before, checkout as wired today", async () => {
    const m = await load({});
    const cfg = m.publicSellerPlanConfig();
    expect(cfg.trialDays).toBe(7);
    expect(cfg.reminderDaysBefore).toBe(2);
    expect(cfg.checkoutMode).toBe("auto");
    expect(cfg.plans.map((p) => p.id)).toEqual(["starter", "growth", "pro"]);
    expect(cfg.plans.find((p) => p.id === "growth")!.amountCents).toBe(7900);
  });

  it("prices and trial come from env without a code change, and bad values fall back", async () => {
    const m = await load({ SELLER_TRIAL_DAYS: "14", SELLER_PLAN_GROWTH_CENTS: "6900", SELLER_CHECKOUT_MODE: "web" });
    expect(m.TRIAL_DAYS).toBe(14);
    expect(m.PLAN_CATALOGUE.growth.amountCents).toBe(6900);
    expect(m.publicSellerPlanConfig().checkoutMode).toBe("web");
    const bad = await load({ SELLER_TRIAL_DAYS: "-3", SELLER_PLAN_GROWTH_CENTS: "free", SELLER_CHECKOUT_MODE: "paypal" });
    expect(bad.TRIAL_DAYS).toBe(7);
    expect(bad.PLAN_CATALOGUE.growth.amountCents).toBe(7900);
    expect(bad.SELLER_CHECKOUT_MODE).toBe("auto");
  });

  it("the reminder always lands inside the trial", async () => {
    const m = await load({ SELLER_TRIAL_DAYS: "2", SELLER_TRIAL_REMINDER_DAYS_BEFORE: "5" });
    expect(m.TRIAL_REMINDER_DAYS_BEFORE).toBe(1);
  });

  it("Stripe Checkout uses the shared trial length", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(new URL("../../routes/subscription.ts", import.meta.url), "utf8");
    expect(route).toContain("trial_period_days: TRIAL_DAYS,");
    expect(route).not.toContain("trial_period_days: 5");
  });
});
