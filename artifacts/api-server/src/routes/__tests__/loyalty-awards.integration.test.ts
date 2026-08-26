/**
 * Loyalty awards must remain correct when Stripe retries or concurrently
 * delivers the same paid-order event.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, loyaltyPoints } from "@workspace/db";
import {
  awardLoyaltyPointsOnce,
  bindLoyaltyRedemptionToCheckout,
  consumeLoyaltyRedemption,
  reserveLoyaltyRedemption,
  reversePurchasePointsOnce,
} from "../loyalty";

const testBuyerIds: string[] = [];

afterEach(async () => {
  while (testBuyerIds.length > 0) {
    const buyerId = testBuyerIds.pop()!;
    await db.delete(loyaltyPoints).where(eq(loyaltyPoints.buyerId, buyerId));
  }
});

describe("loyalty purchase awards", () => {
  it("awards a paid order once when deliveries overlap", async () => {
    const buyerId = `loyalty-test-${crypto.randomUUID()}`;
    const orderId = crypto.randomUUID();
    testBuyerIds.push(buyerId);

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        awardLoyaltyPointsOnce({
          buyerId,
          points: 42,
          source: "order_earn",
          referenceId: orderId,
          note: `Purchase reward for order ${orderId}`,
        }),
      ),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);

    const rows = await db
      .select()
      .from(loyaltyPoints)
      .where(and(
        eq(loyaltyPoints.buyerId, buyerId),
        eq(loyaltyPoints.source, "order_earn"),
        eq(loyaltyPoints.referenceId, orderId),
      ));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBe(42);
  });

  it("reverses refunds idempotently and prevents a late retry from re-awarding points", async () => {
    const buyerId = `loyalty-test-${crypto.randomUUID()}`;
    const orderId = crypto.randomUUID();
    testBuyerIds.push(buyerId);

    await awardLoyaltyPointsOnce({
      buyerId,
      points: 42,
      source: "order_earn",
      referenceId: orderId,
    });

    const firstRefund = await reversePurchasePointsOnce({
      buyerId,
      orderId,
      referenceId: `${orderId}:return:first`,
      requestedPoints: 25,
    });
    const retry = await reversePurchasePointsOnce({
      buyerId,
      orderId,
      referenceId: `${orderId}:return:first`,
      requestedPoints: 25,
    });
    const finalRefund = await reversePurchasePointsOnce({
      buyerId,
      orderId,
      referenceId: `${orderId}:return:second`,
      requestedPoints: 42,
    });

    // Simulates a Stripe retry after the refund/cancellation has committed.
    const lateWebhookRetry = await awardLoyaltyPointsOnce({
      buyerId,
      points: 42,
      source: "order_earn",
      referenceId: orderId,
    });

    expect(firstRefund).toMatchObject({ created: true, pointsReversed: 25 });
    expect(retry).toMatchObject({ created: false, pointsReversed: 0 });
    expect(finalRefund).toMatchObject({ created: true, pointsReversed: 17 });
    expect(lateWebhookRetry.created).toBe(false);

    const [balance] = await db
      .select({ total: sql<number>`COALESCE(SUM(${loyaltyPoints.points}), 0)` })
      .from(loyaltyPoints)
      .where(eq(loyaltyPoints.buyerId, buyerId));

    expect(Number(balance?.total ?? 0)).toBe(0);
  });
});

describe("loyalty checkout redemptions", () => {
  it("reserves one token for checkout and marks it used only after the order succeeds", async () => {
    const buyerId = `loyalty-test-${crypto.randomUUID()}`;
    const token = `LOYAL-TEST-${crypto.randomUUID().toUpperCase()}`;
    const reservationId = `checkout:${crypto.randomUUID()}`;
    const competingReservationId = `checkout:${crypto.randomUUID()}`;
    const stripeSessionId = `cs_test_${crypto.randomUUID()}`;
    const orderId = crypto.randomUUID();
    testBuyerIds.push(buyerId);

    await db.insert(loyaltyPoints).values({
      buyerId,
      points: -250,
      source: "redemption",
      referenceId: token,
      note: "Test redemption",
    });

    const [firstAttempt, secondAttempt] = await Promise.allSettled([
      reserveLoyaltyRedemption(buyerId, token, reservationId, 1_000),
      reserveLoyaltyRedemption(buyerId, token, competingReservationId, 1_000),
    ]);
    expect([firstAttempt, secondAttempt].filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect([firstAttempt, secondAttempt].filter(result => result.status === "rejected")).toHaveLength(1);
    let redemption;
    let winningReservationId: string;
    if (firstAttempt.status === "fulfilled") {
      redemption = firstAttempt.value;
      winningReservationId = reservationId;
    } else {
      expect(secondAttempt.status).toBe("fulfilled");
      if (secondAttempt.status !== "fulfilled") throw secondAttempt.reason;
      redemption = secondAttempt.value;
      winningReservationId = competingReservationId;
    }
    expect(redemption).toMatchObject({ token, pointsUsed: 250, discountCents: 250 });

    const rejectedAttempt = firstAttempt.status === "rejected" ? firstAttempt : secondAttempt;
    expect(rejectedAttempt).toMatchObject({ reason: { code: "LOYALTY_TOKEN_RESERVED" } });

    await bindLoyaltyRedemptionToCheckout(buyerId, token, winningReservationId, stripeSessionId);
    await db.transaction((tx) =>
      consumeLoyaltyRedemption(tx, buyerId, token, stripeSessionId, orderId),
    );

    const [stored] = await db
      .select({
        checkoutSessionId: loyaltyPoints.checkoutSessionId,
        usedAt: loyaltyPoints.usedAt,
        usedOrderId: loyaltyPoints.usedOrderId,
      })
      .from(loyaltyPoints)
      .where(and(eq(loyaltyPoints.buyerId, buyerId), eq(loyaltyPoints.referenceId, token)))
      .limit(1);
    expect(stored).toMatchObject({ checkoutSessionId: stripeSessionId, usedOrderId: orderId });
    expect(stored?.usedAt).toBeInstanceOf(Date);

    await expect(
      reserveLoyaltyRedemption(buyerId, token, `checkout:${crypto.randomUUID()}`, 1_000),
    ).rejects.toMatchObject({ code: "LOYALTY_TOKEN_USED" });
  });
});