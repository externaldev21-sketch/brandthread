import { afterEach, describe, expect, it } from "vitest";
import { featureMinPlans, hasPlan, planAllowances, planForMore } from "../planFeatures";
import { liveAllowanceBlock, monthStartUtc } from "../liveAllowance";
import { emailLimitBody, emailsLeft } from "../emailMarketing/allowance";
import { isMarketingMailerConfigured, marketingFrom, marketingFromHeader } from "../emailMarketing/marketingMailer";
import { REQUIRED_RULES_FOOTER, stripRequiredFooter, withRequiredFooter } from "../giveaways";
import { pushLimitBody } from "../../middlewares/pushBroadcastAllowance";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("plan features", () => {
  it("puts live selling on Growth by default, with an env switch back to Pro", () => {
    expect(featureMinPlans().live_hosting).toBe("growth");
    process.env.LIVE_HOST_MIN_PLAN = "pro";
    expect(featureMinPlans().live_hosting).toBe("pro");
  });
  it("puts drops, giveaways, custom domains and Shopify sync on Growth", () => {
    const min = featureMinPlans();
    expect([min.drops, min.giveaways, min.custom_domain, min.shopify_sync]).toEqual(["growth", "growth", "growth", "growth"]);
  });
  it("ranks plans", () => {
    expect(hasPlan("pro", "growth")).toBe(true);
    expect(hasPlan("starter", "growth")).toBe(false);
  });
  it("names the cheapest plan with room for more", () => {
    expect(planForMore("marketing_emails_per_month", "starter", 600)).toBe("growth");
    expect(planForMore("marketing_emails_per_month", "starter", 20_000)).toBe("pro");
    expect(planForMore("live_minutes_per_month", "growth", 300)).toBe("pro");
    expect(planForMore("push_broadcasts_per_week", "pro", 7)).toBeNull();
  });
  it("reads email allowances from env, including unlimited", () => {
    process.env.EMAIL_MONTHLY_CAP_PRO = "unlimited";
    process.env.EMAIL_MONTHLY_CAP_STARTER = "250";
    expect(planAllowances().marketing_emails_per_month).toEqual({ starter: 250, growth: 10_000, pro: null });
  });
});

describe("live minutes", () => {
  it("lets Growth host until the monthly allowance is used, Pro always", () => {
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
