import { describe, expect, it } from "vitest";
import {
  buildTrialReminderMessage,
  currentTrialOf,
  isDayFourOfFive,
  nativeTrialWindow,
  isPendingTrialReminderDeliverable,
  isReminderWindowOpen,
  isTrialReminderDay,
} from "../sellerTrialReminder";

describe("seller trial reminder day", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-01-06T00:00:00.000Z");
  const start7 = new Date("2026-01-01T00:00:00.000Z");
  const end7 = new Date("2026-01-08T00:00:00.000Z");

  it("a 7-day trial reminds on day 5, two days before the charge", () => {
    expect(isTrialReminderDay(start7, end7, new Date("2026-01-05T12:00:00.000Z"))).toBe(true);
    expect(isTrialReminderDay(start7, end7, new Date("2026-01-04T23:59:00.000Z"))).toBe(false);
    expect(isTrialReminderDay(start7, end7, new Date("2026-01-06T00:00:00.000Z"))).toBe(false);
    expect(isReminderWindowOpen(start7, end7, new Date("2026-01-07T12:00:00.000Z"))).toBe(true);
    expect(isReminderWindowOpen(start7, end7, new Date("2026-01-08T00:00:00.000Z"))).toBe(false);
  });

  it("only considers one strict day eligible, and only whole-day trial windows", () => {
    // A 5-day trial still in flight reminds two days before its charge too (day 3).
    expect(isDayFourOfFive(start, end, new Date("2026-01-03T12:00:00.000Z"))).toBe(true);
    expect(isDayFourOfFive(start, end, new Date("2026-01-02T23:59:00.000Z"))).toBe(false);
    expect(isDayFourOfFive(start, end, new Date("2026-01-04T00:00:00.000Z"))).toBe(false);
    expect(isDayFourOfFive(start, new Date("2026-01-07T12:00:00.000Z"), new Date("2026-01-04T12:00:00.000Z"))).toBe(false);
    expect(isReminderWindowOpen(start, end, new Date("2026-01-05T12:00:00.000Z"))).toBe(true);
  });

  it("says what is charged and when, and that cancelling before then costs nothing", () => {
    const used = buildTrialReminderMessage({ productsUsed: 3, ordersUsed: 7, plan: "growth", trialEndsAt: end });
    expect(used.title).toBe("Your free trial ends Jan 6");
    expect(used.body).toBe("You've built 3 products and 7 orders so far. Your Growth plan starts on Jan 6 at $49/month. Cancel anytime before then and you won't be charged.");
    expect(used.entitledFeatures).toContain("up to 50 live products");

    const fresh = buildTrialReminderMessage({ plan: "starter", trialEndsAt: end });
    expect(fresh.body).toBe("Your Starter plan starts on Jan 6 at $19.99/month. Cancel anytime before then and you won't be charged.");
    expect(fresh.entitledFeatures).toContain("up to 10 live products");
    expect(buildTrialReminderMessage({ plan: "pro", trialEndsAt: end }).entitledFeatures).toContain("unlimited products");
  });

  it("drains a late day-four failure on day five but suppresses cancelled or opted-out trials", () => {
    const dayFive = new Date("2026-01-05T12:00:00.000Z");
    const base = {
      currentTrialStartedAt: start,
      currentTrialEndsAt: end,
      eventTrialEndsAt: end,
      subscriptionPreference: true,
      now: dayFive,
    };
    expect(isPendingTrialReminderDeliverable({ ...base, sellerStatus: "trialing" })).toBe(true);
    expect(isPendingTrialReminderDeliverable({ ...base, sellerStatus: "canceled" })).toBe(false);
    expect(isPendingTrialReminderDeliverable({ ...base, sellerStatus: "trialing", subscriptionPreference: false })).toBe(false);
    // Cancelled during the trial: it won't be charged, so no reminder.
    expect(isPendingTrialReminderDeliverable({ ...base, sellerStatus: "trialing", cancelAtPeriodEnd: true })).toBe(false);
  });

  it("covers App Store / Play trials: window from the trial end, store link to cancel", () => {
    expect(nativeTrialWindow({ trialEndsAt: end7, expiresAt: null })).toEqual({ start: start7, end: end7 });
    expect(nativeTrialWindow({ trialEndsAt: null, expiresAt: null })).toBeNull();

    const apple = currentTrialOf({
      stripeStatus: "canceled", stripeTrialStartedAt: null, stripeTrialEndsAt: null, stripeCancelAtPeriodEnd: false,
      native: { status: "trial", trialEndsAt: end7, expiresAt: end7, providerData: { items: [{ store: "app_store", auto_renewal_status: "will_renew" }] } },
    });
    expect(apple).toMatchObject({ status: "trialing", start: start7, end: end7, cancelAtPeriodEnd: false, manageUrl: "https://apps.apple.com/account/subscriptions" });
    expect(isTrialReminderDay(apple.start!, apple.end!, new Date("2026-01-05T12:00:00.000Z"))).toBe(true);

    const cancelledInStore = currentTrialOf({
      stripeStatus: null, stripeTrialStartedAt: null, stripeTrialEndsAt: null, stripeCancelAtPeriodEnd: null,
      native: { status: "trial", trialEndsAt: end7, expiresAt: end7, providerData: { items: [{ store: "play_store", auto_renewal_status: "will_not_renew" }] } },
    });
    expect(cancelledInStore.cancelAtPeriodEnd).toBe(true);

    const web = currentTrialOf({
      stripeStatus: "trialing", stripeTrialStartedAt: start7, stripeTrialEndsAt: end7, stripeCancelAtPeriodEnd: true, native: null,
    });
    expect(web).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true });
    expect(web.manageUrl).toMatch(/\/subscription$/);
  });
});