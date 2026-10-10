import { afterEach, describe, expect, it } from "vitest";
import { featureMinPlans, hasPlan, planAllowances, planForMore, planIncludes, publicPlanFeatures } from "../planFeatures";
import { PLAN_CATALOGUE, planTierFeatures } from "../planCatalogue";
import { liveAllowanceBlock, monthStartUtc } from "../liveAllowance";
import { emailLimitBody, emailsLeft } from "../emailMarketing/allowance";
import { isMarketingMailerConfigured, marketingFrom, marketingFromHeader } from "../emailMarketing/marketingMailer";
import { REQUIRED_RULES_FOOTER, stripRequiredFooter, withRequiredFooter } from "../giveaways";
import { pushLimitBody } from "../../middlewares/pushBroadcastAllowance";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("plan features", () => {
  it("reads Dev's tiers from the one plan config", () => {
    expect(featureMinPlans()).toEqual({
      live_hosting: "growth",
      drops: "growth",
      boosts: "growth",
      custom_domain: "growth",
      manufacturer_hub: "growth",
      advanced_analytics: "growth",
      analytics_export: "pro",
    });
    const tiers = planTierFeatures();
    expect([tiers.starter.analytics, tiers.growth.analytics, tiers.pro.analytics]).toEqual(["basic", "advanced", "full"]);
    expect([tiers.starter.prioritySupport, tiers.growth.prioritySupport, tiers.pro.prioritySupport]).toEqual([false, false, true]);
    expect([tiers.starter.payoutSpeed, tiers.pro.payoutSpeed]).toEqual(["standard", "faster"]);
  });
  it("answers per plan", () => {
    expect(planIncludes("starter", "live_hosting")).toBe(false);
    expect(planIncludes("growth", "analytics_export")).toBe(false);
    expect(planIncludes("pro", "analytics_export")).toBe(true);
  });
  it("ranks plans", () => {
    expect(hasPlan("pro", "growth")).toBe(true);
    expect(hasPlan("starter", "growth")).toBe(false);
  });
  it("gives Starter no marketing email and names the cheapest plan with room for more", () => {
    expect(planAllowances().marketing_emails_per_month).toEqual({ starter: 0, growth: 10_000, pro: 50_000 });
    expect(planForMore("marketing_emails_per_month", "starter", 1)).toBe("growth");
    expect(planForMore("marketing_emails_per_month", "starter", 20_000)).toBe("pro");
    expect(planForMore("push_broadcasts_per_week", "pro", 7)).toBeNull();
  });
  it("has no live-minute cap on Growth unless one is set", () => {
    expect(planAllowances().live_minutes_per_month).toEqual({ starter: 0, growth: null, pro: null });
    process.env.LIVE_GROWTH_MINUTES_PER_MONTH = "240";
    expect(planForMore("live_minutes_per_month", "growth", 300)).toBe("pro");
  });
  it("reads email caps from env, including unlimited", () => {
    process.env.EMAIL_MONTHLY_CAP_PRO = "unlimited";
    process.env.EMAIL_MONTHLY_CAP_STARTER = "250";
    expect(planAllowances().marketing_emails_per_month).toEqual({ starter: 250, growth: 10_000, pro: null });
  });
  it("publishes every tier for the plan screen, with the product cap and seats from the same config", () => {
    const pub = publicPlanFeatures();
    expect(Object.keys(pub.tiers)).toEqual(["starter", "growth", "pro"]);
    expect(pub.tiers.starter).toMatchObject({ analytics: "basic", emailSendsPerMonth: 0, productLimit: PLAN_CATALOGUE.starter.limits.products, staffSeats: PLAN_CATALOGUE.starter.limits.teamSeats });
  });
});

describe("live minutes", () => {
  it("lets Growth host until the monthly allowance is used, Pro always", () => {
    process.env.LIVE_GROWTH_MINUTES_PER_MONTH = "240";
    expect(liveAllowanceBlock("growth", 239)).toBeNull();
    expect(liveAllowanceBlock("growth", 240)).toMatchObject({ code: "PLAN_LIMIT_REACHED", requiredPlan: "pro", limit: 240 });
    expect(liveAllowanceBlock("pro", 100_000)).toBeNull();
  });
  it("counts from the first of the month (UTC)", () => {
    expect(monthStartUtc(new Date("2026-10-10T05:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("email allowance", () => {
  it("computes what's left", () => {
    expect(emailsLeft(500, 120)).toBe(380);
    expect(emailsLeft(500, 900)).toBe(0);
    expect(emailsLeft(null, 900)).toBe(Number.POSITIVE_INFINITY);
  });
  it("explains the limit and the plan that fits", () => {
    expect(emailLimitBody("starter", 500, 300, 400)).toMatchObject({
      code: "PLAN_LIMIT_REACHED", requiredPlan: "growth", resource: "marketing_emails",
      message: "This campaign goes to 400 people and your plan has 200 emails left this month. Upgrade to send it.",
    });
    expect(emailLimitBody("growth", 10_000, 10_000, 1).message).toBe("You've sent this month's 10,000 marketing emails. Upgrade to send more.");
  });
  it("shows the upgrade prompt, not a used-up count, on a plan without email", () => {
    expect(emailLimitBody("starter", 0, 0, 1)).toMatchObject({
      code: "PLAN_REQUIRED", requiredPlan: "growth", message: "Email marketing is on the Growth plan. Upgrade to send campaigns.",
    });
  });
});

describe("marketing sender", () => {
  it("is off until MARKETING_MAIL_FROM is set", () => {
    expect(isMarketingMailerConfigured({ RESEND_API_KEY: "k" })).toBe(false);
    expect(isMarketingMailerConfigured({ RESEND_API_KEY: "k", MARKETING_MAIL_FROM: "Shops <shops@news.brandthread.app>" })).toBe(true);
  });
  it("refuses the auth mail domain", () => {
    expect(marketingFrom({ MAIL_FROM: "Brandthread <no-reply@brandthread.app>", MARKETING_MAIL_FROM: "shops@brandthread.app" })).toBeNull();
    expect(marketingFrom({ MAIL_FROM: "Brandthread <no-reply@brandthread.app>", MARKETING_MAIL_FROM: "shops@news.brandthread.app" }))
      .toEqual({ name: null, address: "shops@news.brandthread.app" });
  });
  it("sends as the store's name on the marketing address", () => {
    const env = { MARKETING_MAIL_FROM: "Brandthread Shops <shops@news.brandthread.app>" };
    expect(marketingFromHeader('Halo "Studio"', env)).toBe("Halo Studio <shops@news.brandthread.app>");
    expect(marketingFromHeader(null, env)).toBe("Brandthread Shops <shops@news.brandthread.app>");
  });
});

describe("giveaway rules footer", () => {
  it("is always present once, whatever the seller wrote", () => {
    const shown = withRequiredFooter("NO PURCHASE NECESSARY.");
    expect(shown.endsWith(REQUIRED_RULES_FOOTER)).toBe(true);
    expect(withRequiredFooter(shown)).toBe(shown);
    expect(stripRequiredFooter(shown)).toBe("NO PURCHASE NECESSARY.");
    expect(withRequiredFooter("")).toBe(REQUIRED_RULES_FOOTER);
    expect(REQUIRED_RULES_FOOTER).toContain("Apple");
  });
});

describe("push allowance", () => {
  it("points Starter to Growth", () => {
    expect(pushLimitBody("starter", 1, 1)).toMatchObject({ code: "PLAN_LIMIT_REACHED", requiredPlan: "growth", limit: 1 });
  });
});
