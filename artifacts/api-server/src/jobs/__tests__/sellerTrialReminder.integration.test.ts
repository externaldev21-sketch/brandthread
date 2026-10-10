/**
 * The day-5 trial reminder end to end against Postgres: push + email with a
 * manage / cancel link, Stripe and App Store trials, nothing for a trial the
 * seller already cancelled, and exactly once per trial.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, sellerSubscriptionEntitlements, sellerTrialReminderEvents, users } from "@workspace/db";

const sent = vi.hoisted(() => ({ emails: [] as any[], pushes: [] as any[] }));
vi.mock("../../lib/brandthreadEmail", () => ({
  sendTrialReminderEmail: async (options: any) => { sent.emails.push(options); return true; },
}));
vi.mock("../../lib/push", () => ({
  // No registered device: the email alone delivers the reminder.
  sendPushToUser: async (userId: string, message: any) => { sent.pushes.push({ userId, message }); return false; },
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));

const suffix = crypto.randomBytes(5).toString("hex");
const web = `remind-web-${suffix}`;
const apple = `remind-apple-${suffix}`;
const cancelled = `remind-cancelled-${suffix}`;
const everyone = [web, apple, cancelled];
const DAY = 86_400_000;
const now = new Date();
// Day 5 of a 7-day trial.
const start = new Date(now.getTime() - 4.5 * DAY);
const end = new Date(start.getTime() + 7 * DAY);

beforeAll(async () => {
  await db.insert(users).values(everyone.map((clerkId) => ({
    clerkId, email: `${clerkId}@remind.invalid`, name: clerkId, role: "seller", accountType: "seller",
  })));
  const { eq } = await import("drizzle-orm");
  for (const id of [web, cancelled]) {
    await db.update(users).set({
      subscriptionStatus: "trialing", subscriptionPlanId: "growth",
      subscriptionTrialStartedAt: start, subscriptionTrialEndsAt: end,
      subscriptionCancelAtPeriodEnd: id === cancelled,
    }).where(eq(users.clerkId, id));
  }
  await db.insert(sellerSubscriptionEntitlements).values({
    clerkUserId: apple, provider: "revenuecat", planId: "starter", status: "trial",
    trialEndsAt: end, expiresAt: end, productIdentifier: "brandthread_starter_monthly",
    providerData: { items: [{ status: "trialing", store: "app_store", auto_renewal_status: "will_renew" }] },
  });
});

afterAll(async () => {
  await db.delete(sellerTrialReminderEvents).where(inArray(sellerTrialReminderEvents.sellerId, everyone));
  await db.delete(sellerSubscriptionEntitlements).where(inArray(sellerSubscriptionEntitlements.clerkUserId, everyone));
  await db.delete(users).where(inArray(users.clerkId, everyone));
});

describe("runSellerTrialReminder", () => {
  it("emails (and pushes) Stripe and App Store trials on day 5 with a link to cancel, once", async () => {
    const { runSellerTrialReminder } = await import("../sellerTrialReminder");
    await runSellerTrialReminder(now);

    const mine = sent.emails.filter((e) => everyone.some((id) => e.to.startsWith(id)));
    expect(mine.map((e) => e.to).sort()).toEqual([`${apple}@remind.invalid`, `${web}@remind.invalid`]);
    const webEmail = mine.find((e) => e.to.startsWith(web));
    expect(webEmail).toMatchObject({ planLabel: "Growth", amount: "$49", trialEndsAt: end });
    expect(webEmail.manageUrl).toMatch(/\/subscription$/);
    expect(webEmail.idempotencyKey).toMatch(/^trial-reminder\//);
    expect(mine.find((e) => e.to.startsWith(apple))).toMatchObject({
      planLabel: "Starter", amount: "$19.99", manageUrl: "https://apps.apple.com/account/subscriptions",
    });
    const push = sent.pushes.find((p) => p.userId === web);
    expect(push.message.body).toContain("Cancel anytime before then and you won't be charged.");
    expect(push.message.data.manageUrl).toBe(webEmail.manageUrl);

    const events = await db.select().from(sellerTrialReminderEvents).where(inArray(sellerTrialReminderEvents.sellerId, everyone));
    expect(events.filter((e) => e.status === "sent").map((e) => e.sellerId).sort()).toEqual([apple, web].sort());
    expect(events.some((e) => e.sellerId === cancelled)).toBe(false);

    // Hourly re-runs never send a second reminder for the same trial.
    const before = sent.emails.length;
    await runSellerTrialReminder(new Date(now.getTime() + 60 * 60 * 1000));
    expect(sent.emails.length).toBe(before);
  });
});
