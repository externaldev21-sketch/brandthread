import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, stripeTrialWarningEvents, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const sendPushToUser = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../lib/push", () => ({ sendPushToUser }));

const { handleSubscriptionTrialWillEnd } = await import("../webhooks");

const cleanup = {
  clerkId: "",
  eventId: "",
};

afterEach(async () => {
  if (cleanup.eventId) {
    await db
      .delete(stripeTrialWarningEvents)
      .where(eq(stripeTrialWarningEvents.eventId, cleanup.eventId));
  }
  if (cleanup.clerkId) {
    await db.delete(users).where(eq(users.clerkId, cleanup.clerkId));
  }
  cleanup.clerkId = "";
  cleanup.eventId = "";
  sendPushToUser.mockReset();
  sendPushToUser.mockResolvedValue(undefined);
});

describe("seller trial-ending warning idempotency", () => {
  it("records the Stripe event before delivery and skips a replay", async () => {
    const clerkId = `trial-warning-${crypto.randomUUID()}`;
    const eventId = `evt_trial_warning_${crypto.randomUUID()}`;
    cleanup.clerkId = clerkId;
    cleanup.eventId = eventId;

    await db.insert(users).values({
      clerkId,
      email: `${clerkId}@example.test`,
      name: "Trial Warning Seller",
      role: "seller",
      accountType: "seller",
      stripeCustomerId: `cus_trial_warning_${crypto.randomUUID()}`,
    });

    const subscription = {
      id: `sub_${crypto.randomUUID()}`,
      customer: `cus_trial_warning_${crypto.randomUUID()}`,
      trial_end: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      items: { data: [] },
    };
    // Match the customer to the seller created for this test.
    subscription.customer = (
      await db.select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1)
    )[0].stripeCustomerId!;

    await handleSubscriptionTrialWillEnd(subscription, eventId);
    await handleSubscriptionTrialWillEnd(subscription, eventId);

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    const [marker] = await db
      .select({ eventId: stripeTrialWarningEvents.eventId })
      .from(stripeTrialWarningEvents)
      .where(eq(stripeTrialWarningEvents.eventId, eventId));
    expect(marker?.eventId).toBe(eventId);
  });

  it("releases the marker when delivery fails so a retry can send", async () => {
    const clerkId = `trial-warning-${crypto.randomUUID()}`;
    const eventId = `evt_trial_warning_${crypto.randomUUID()}`;
    cleanup.clerkId = clerkId;
    cleanup.eventId = eventId;
    const customerId = `cus_trial_warning_${crypto.randomUUID()}`;

    await db.insert(users).values({
      clerkId,
      email: `${clerkId}@example.test`,
      name: "Trial Warning Seller",
      role: "seller",
      accountType: "seller",
      stripeCustomerId: customerId,
    });

    const subscription = {
      id: `sub_${crypto.randomUUID()}`,
      customer: customerId,
      trial_end: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      items: { data: [] },
    };
    sendPushToUser.mockRejectedValueOnce(new Error("temporary delivery failure"));

    await expect(handleSubscriptionTrialWillEnd(subscription, eventId)).rejects.toThrow(
      "temporary delivery failure",
    );
    expect(
      await db
        .select({ eventId: stripeTrialWarningEvents.eventId })
        .from(stripeTrialWarningEvents)
        .where(eq(stripeTrialWarningEvents.eventId, eventId)),
    ).toHaveLength(0);

    await handleSubscriptionTrialWillEnd(subscription, eventId);
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
  });
});