/**
 * Loyalty awards must remain correct when Stripe retries or concurrently
 * delivers the same paid-order event.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, loyaltyPoints } from "@workspace/db";
import { awardLoyaltyPointsOnce, reversePurchasePointsOnce } from "../loyalty";

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