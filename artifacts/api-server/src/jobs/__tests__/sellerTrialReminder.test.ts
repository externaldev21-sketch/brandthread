import { describe, expect, it } from "vitest";
import {
  buildTrialReminderMessage,
  isDayFourOfFive,
  isPendingTrialReminderDeliverable,
  isReminderWindowOpen,
} from "../sellerTrialReminder";

describe("seller trial day-four reminder", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-01-06T00:00:00.000Z");

  it("only considers the fourth day of a five-day window eligible", () => {
    expect(isDayFourOfFive(start, end, new Date("2026-01-04T12:00:00.000Z"))).toBe(true);
    expect(isDayFourOfFive(start, end, new Date("2026-01-03T23:59:00.000Z"))).toBe(false);
    expect(isDayFourOfFive(start, end, new Date("2026-01-05T00:00:00.000Z"))).toBe(false);
    expect(isDayFourOfFive(start, new Date("2026-01-07T00:00:00.000Z"), new Date("2026-01-04T12:00:00.000Z"))).toBe(false);
    expect(isReminderWindowOpen(start, end, new Date("2026-01-05T12:00:00.000Z"))).toBe(true);
  });

  it("uses measured usage when available and truthful plan entitlements otherwise", () => {
    const used = buildTrialReminderMessage({
      productsUsed: 3,
      ordersUsed: 7,
      plan: "growth",
      trialEndsAt: end,
    });
    expect(used.body).toContain("3 products");
    expect(used.body).toContain("7 orders");
    expect(used.body).toContain("unlimited products");
    expect(used.title).toContain("Jan 6, 2026");

    const entitled = buildTrialReminderMessage({ plan: "starter", trialEndsAt: end });
    expect(entitled.body).toContain("up to 25 products");
    expect(entitled.body).not.toContain("already built");
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
  });
});