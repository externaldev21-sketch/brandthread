import { describe, expect, it } from "vitest";
import { decideNudge } from "../nudges";
import { isoWeekKey, isWeeklySummaryHour } from "../weekly";
import { wantsSellerEmail } from "../mirror";
import { checkoutBlockedEmail, newOrderEmail, nudgeEmail, payoutFailedEmail, weeklySummaryEmail } from "../emails";

const HOUR = 3_600_000;
const now = new Date("2026-10-12T16:30:00Z"); // a Monday
const base = { onboardingComplete: true, activeProducts: 0, stripeActive: false, storePublished: false };
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);

describe("activation nudges", () => {
  it("waits 24h before asking for a first product", () => {
    expect(decideNudge({ ...base, createdAt: at(20) }, now)).toBeNull();
    expect(decideNudge({ ...base, createdAt: at(30) }, now)).toMatchObject({ kind: "no_product", push: true });
  });
  it("asks for payouts at 48h once a product is live", () => {
    expect(decideNudge({ ...base, activeProducts: 3, createdAt: at(40) }, now)).toBeNull();
    expect(decideNudge({ ...base, activeProducts: 3, createdAt: at(50) }, now)).toMatchObject({ kind: "no_payouts" });
  });
  it("asks to publish at 72h when product + payouts are done", () => {
    const ready = { ...base, activeProducts: 1, stripeActive: true };
    expect(decideNudge({ ...ready, createdAt: at(60) }, now)).toBeNull();
    expect(decideNudge({ ...ready, createdAt: at(80) }, now)).toMatchObject({ kind: "not_published", claimKind: "nudge_not_published" });
    expect(decideNudge({ ...ready, storePublished: true, createdAt: at(80) }, now)).toBeNull();
  });
  it("emails unfinished onboarding at 2h and again at 24h, never by push", () => {
    const pending = { ...base, onboardingComplete: false };
    expect(decideNudge({ ...pending, createdAt: at(1) }, now)).toBeNull();
    expect(decideNudge({ ...pending, createdAt: at(3) }, now)).toEqual({ kind: "onboarding_abandoned", claimKind: "nudge_onboarding_2h", push: false });
    expect(decideNudge({ ...pending, createdAt: at(26) }, now)).toMatchObject({ claimKind: "nudge_onboarding_24h" });
    expect(decideNudge({ ...pending, createdAt: at(24 * 8) }, now)).toBeNull();
  });
  it("stops nudging old accounts", () => {
    expect(decideNudge({ ...base, createdAt: at(24 * 15) }, now)).toBeNull();
  });
});

describe("weekly summary timing", () => {
  it("sends Monday 9am in the seller's time zone", () => {
    expect(isWeeklySummaryHour(new Date("2026-10-12T16:30:00Z"), "America/Los_Angeles")).toBe(true); // 9:30 PDT
    expect(isWeeklySummaryHour(new Date("2026-10-12T16:30:00Z"), "America/New_York")).toBe(false); // 12:30 EDT
    expect(isWeeklySummaryHour(new Date("2026-10-12T09:10:00Z"), null)).toBe(true);
    expect(isWeeklySummaryHour(new Date("2026-10-13T09:10:00Z"), "UTC")).toBe(false); // Tuesday
  });
  it("keys the claim by ISO week", () => {
    expect(isoWeekKey(new Date("2026-10-12T16:30:00Z"), "America/Los_Angeles")).toBe("2026-W42");
    expect(isoWeekKey(new Date("2021-01-03T12:00:00Z"), "UTC")).toBe("2020-W53");
  });
  it("falls back to UTC for an unknown zone", () => {
    expect(isWeeklySummaryHour(new Date("2026-10-12T09:10:00Z"), "Not/AZone")).toBe(true);
  });
});

describe("seller email gate", () => {
  it("respects the email switch for each category", () => {
    expect(wantsSellerEmail({ type: "new_order_received", accountType: "seller", preferences: null, digest: "realtime" })).toBe(true);
    expect(wantsSellerEmail({ type: "new_order_received", accountType: "seller", preferences: { "email:new_orders": false }, digest: "realtime" })).toBe(false);
    expect(wantsSellerEmail({ type: "payout_failed", accountType: "seller", preferences: { "email:payout_confirmations": false }, digest: null })).toBe(false);
    expect(wantsSellerEmail({ type: "new_review", accountType: "seller", preferences: null, digest: null })).toBe(true);
  });
  it("skips per-order emails for daily-digest sellers and ignores other types", () => {
    expect(wantsSellerEmail({ type: "new_order_received", accountType: "seller", preferences: null, digest: "daily" })).toBe(false);
    expect(wantsSellerEmail({ type: "post_like", accountType: "seller", preferences: null, digest: null })).toBe(false);
  });
});

describe("seller email copy", () => {
  it("new order shows number, items and total", () => {
    const email = newOrderEmail({ orderNumber: "1042", totalCents: 12_500, itemCount: 3, orderId: "o1" });
    expect(email.subject).toBe("New order #1042 for $125.00");
    expect(email.html).toContain("/order-detail?id=o1");
  });
  it("payout failed links to payout setup", () => {
    expect(payoutFailedEmail({ amountCents: 4_000, detail: null }).html).toContain("/payout-setup");
  });
  it("checkout blocked links to payouts", () => {
    expect(checkoutBlockedEmail().html).toContain("/payouts");
  });
  it("nudges carry a stop link when one exists", () => {
    expect(nudgeEmail("no_product", "https://x.test/stop").html).toContain("https://x.test/stop");
    expect(nudgeEmail("no_product", null).html).toContain("Settings → Notifications");
  });
  it("a week without sales suggests three things", () => {
    const email = weeklySummaryEmail({ salesCents: 0, orderCount: 0, toShipCount: 0, visits: 12, topProduct: null, activeProducts: 2 }, "Oct 5 – Oct 11", null);
    expect(email.subject).toBe("Your week on Brandthread: 3 things to try");
    expect((email.html.match(/<li /g) ?? []).length).toBe(3);
  });
  it("a week with sales shows the numbers", () => {
    const email = weeklySummaryEmail({ salesCents: 31_000, orderCount: 4, toShipCount: 1, visits: 90, topProduct: { name: "Tee", units: 3 }, activeProducts: 8 }, "Oct 5 – Oct 11", null);
    expect(email.subject).toBe("Your week on Brandthread: $310.00 in sales");
    expect(email.html).toContain("Tee (3 sold)");
    expect(email.html).toContain("Orders to ship");
  });
});
