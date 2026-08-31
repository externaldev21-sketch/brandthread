import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const state = vi.hoisted(() => ({ pushCalls: 0 }));

vi.mock("../../lib/push", () => ({
  sendPushToUser: vi.fn(async () => {
    state.pushCalls += 1;
  }),
}));

import { db, notificationsFeed, users } from "@workspace/db";
import { handleInvoicePaymentFailed } from "../webhooks";

const sellerId = `clerk_subscription_failure_${process.pid}`;
const customerId = `cus_subscription_failure_${process.pid}`;
const subscriptionId = `sub_subscription_failure_${process.pid}`;
const invoiceId = `in_subscription_failure_${process.pid}`;

afterEach(async () => {
  await db
    .delete(notificationsFeed)
    .where(
      and(
        eq(notificationsFeed.userId, sellerId),
        eq(notificationsFeed.targetId, invoiceId),
      ),
    );
  await db.delete(users).where(eq(users.clerkId, sellerId));
});

describe("failed subscription invoice recovery notification", () => {
  beforeEach(async () => {
    state.pushCalls = 0;
    await db
      .delete(notificationsFeed)
      .where(
        and(
          eq(notificationsFeed.userId, sellerId),
          eq(notificationsFeed.targetId, invoiceId),
        ),
      );
    await db.delete(users).where(eq(users.clerkId, sellerId));
    await db.insert(users).values({
      clerkId: sellerId,
      email: `${sellerId}@example.test`,
      name: "Subscription Failure Test Seller",
      role: "owner",
      accountType: "seller",
      stripeCustomerId: customerId,
      subscriptionId,
    });
  });

  it("creates one alert and sends one push when the same invoice is handled concurrently", async () => {
    const invoice = {
      id: invoiceId,
      customer: customerId,
      subscription: subscriptionId,
      attempt_count: 1,
      next_payment_attempt: null,
    };

    await Promise.all(
      Array.from({ length: 8 }, () => handleInvoicePaymentFailed(invoice)),
    );

    const notifications = await db
      .select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(
        and(
          eq(notificationsFeed.userId, sellerId),
          eq(notificationsFeed.type, "subscription_payment_failed"),
          eq(notificationsFeed.targetId, invoiceId),
        ),
      );

    expect(notifications).toHaveLength(1);
    expect(state.pushCalls).toBe(1);
  });
});
