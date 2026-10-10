import { describe, expect, it } from "vitest";
import { sanitizeProperties } from "../analytics";
import { revenueCatSubscriptionEvent, stripeSubscriptionEndedEvent, stripeSubscriptionEvents } from "../subscriptionAnalytics";

describe("Stripe subscription funnel events (BT-450)", () => {
  it("trial start, then conversion to paid", () => {
    expect(stripeSubscriptionEvents({ sub: { status: "trialing" }, plan: "starter", previousStatus: "none" }))
      .toEqual([{ event: "trial_started", props: { plan: "starter", provider: "stripe" } }]);
    expect(stripeSubscriptionEvents({ sub: { status: "active" }, plan: "starter", previousStatus: "trialing" }))
      .toEqual([{ event: "subscription_started", props: { plan: "starter", provider: "stripe", from_trial: true } }]);
  });

  it("a redelivered or renewal update emits nothing new", () => {
    expect(stripeSubscriptionEvents({ sub: { status: "trialing" }, plan: "growth", previousStatus: "trialing" })).toEqual([]);
    expect(stripeSubscriptionEvents({ sub: { status: "active" }, plan: "growth", previousStatus: "active" })).toEqual([]);
    // Recovering from past_due isn't a new purchase.
    expect(stripeSubscriptionEvents({ sub: { status: "active" }, plan: "growth", previousStatus: "past_due" })).toEqual([]);
  });

  it("cancel is the moment cancel_at_period_end turns on; end is the deletion", () => {
    expect(stripeSubscriptionEvents({
      sub: { status: "trialing", cancel_at_period_end: true }, plan: "pro", previousStatus: "trialing",
      previousAttributes: { cancel_at_period_end: false },
    })).toEqual([{ event: "subscription_cancelled", props: { plan: "pro", provider: "stripe", in_trial: true } }]);
    expect(stripeSubscriptionEndedEvent("pro")).toEqual({ event: "subscription_ended", props: { plan: "pro", provider: "stripe" } });
  });

  it("past_due is reported once", () => {
    expect(stripeSubscriptionEvents({ sub: { status: "past_due" }, plan: "growth", previousStatus: "active" }).map((e) => e.event))
      .toEqual(["subscription_past_due"]);
  });
});

describe("RevenueCat subscription funnel events (BT-450)", () => {
  it("maps trial, purchase, conversion, cancel, expiry and billing issues", () => {
    const base = { product_id: "brandthread_growth_monthly", store: "APP_STORE" };
    expect(revenueCatSubscriptionEvent({ ...base, type: "INITIAL_PURCHASE", period_type: "TRIAL" }))
      .toEqual({ event: "trial_started", props: { plan: "growth", provider: "app_store" } });
    expect(revenueCatSubscriptionEvent({ ...base, type: "INITIAL_PURCHASE", period_type: "NORMAL" })?.event).toBe("subscription_started");
    expect(revenueCatSubscriptionEvent({ ...base, type: "RENEWAL", is_trial_conversion: true })?.props).toMatchObject({ from_trial: true });
    expect(revenueCatSubscriptionEvent({ ...base, type: "RENEWAL", is_trial_conversion: false })).toBeNull();
    expect(revenueCatSubscriptionEvent({ ...base, type: "CANCELLATION", period_type: "TRIAL" })?.props).toMatchObject({ in_trial: true });
    expect(revenueCatSubscriptionEvent({ ...base, type: "EXPIRATION" })?.event).toBe("subscription_ended");
    expect(revenueCatSubscriptionEvent({ ...base, type: "BILLING_ISSUE", store: "PLAY_STORE" }))
      .toEqual({ event: "subscription_past_due", props: { plan: "growth", provider: "play_store" } });
  });

  it("ignores consumables and unknown products", () => {
    expect(revenueCatSubscriptionEvent({ type: "NON_RENEWING_PURCHASE", product_id: "bt_credits_100" })).toBeNull();
    expect(revenueCatSubscriptionEvent({ type: "INITIAL_PURCHASE", product_id: "brandthread_pro_monthly:monthly", period_type: "NORMAL" })?.props.plan).toBe("pro");
  });

  it("every property survives the server allow-list", () => {
    const event = revenueCatSubscriptionEvent({ type: "CANCELLATION", product_id: "brandthread_starter_monthly", store: "APP_STORE" })!;
    expect(sanitizeProperties(event.event, event.props)).toEqual(event.props);
  });
});
