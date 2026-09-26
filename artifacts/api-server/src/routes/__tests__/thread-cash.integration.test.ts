/**
 * Thread Cash wallet integrity: double check-in claims, concurrent
 * redemptions, and the reserve/consume/release checkout dance must all
 * behave exactly like the loyalty-points equivalents they're modeled on.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, threadCashEntries, threadCashStreaks } from "@workspace/db";
import {
  awardDailyCheckInOnce,
  bindThreadCashRedemptionToCheckout,
  consumeThreadCashRedemption,
  getBalanceCents,
  redeemThreadCash,
  refundThreadCashSpend,
  reserveThreadCashRedemption,
} from "../../lib/threadCash/wallet";

const testBuyerIds: string[] = [];

afterEach(async () => {
  while (testBuyerIds.length > 0) {
    const buyerId = testBuyerIds.pop()!;
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, buyerId));
    await db.delete(threadCashStreaks).where(eq(threadCashStreaks.buyerId, buyerId));
  }
});

describe("daily check-in award", () => {
  it("awards a check-in exactly once when requests race for the same local date", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);
    const localDate = "2025-06-01";

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        awardDailyCheckInOnce({ buyerId, localDate, earnedCents: 10, streakBonusCents: 0 })),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBe(10);
  });

  it("awards both the daily amount and the streak bonus in the same claim", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);

    await awardDailyCheckInOnce({ buyerId, localDate: "2025-06-07", earnedCents: 10, streakBonusCents: 100 });

    const rows = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, buyerId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(["daily_checkin", "streak_bonus"]);
    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBe(110);
  });

  it("awards a new date independently of an already-claimed date", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);

    await awardDailyCheckInOnce({ buyerId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 });
    await awardDailyCheckInOnce({ buyerId, localDate: "2025-06-02", earnedCents: 10, streakBonusCents: 0 });

    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBe(20);
  });
});

describe("checkout redemption", () => {
  it("serializes concurrent redemptions so deductions cannot exceed the balance", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);
    await db.insert(threadCashEntries).values({
      buyerId, amountCents: 150, source: "daily_checkin", referenceId: crypto.randomUUID(),
    });

    const attempts = await Promise.allSettled([
      redeemThreadCash(buyerId, 100, crypto.randomUUID()),
      redeemThreadCash(buyerId, 100, crypto.randomUUID()),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(1);

    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBe(50);
  });

  it("redeeming twice with the SAME idempotency key spends exactly once", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);
    await db.insert(threadCashEntries).values({
      buyerId, amountCents: 500, source: "daily_checkin", referenceId: crypto.randomUUID(),
    });
    const idempotencyKey = crypto.randomUUID();

    const [first, second] = await Promise.all([
      redeemThreadCash(buyerId, 200, idempotencyKey),
      redeemThreadCash(buyerId, 200, idempotencyKey),
    ]);
    expect(first.token).toBe(second.token);
    expect(first.discountCents).toBe(200);

    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBe(300); // spent exactly once, not twice
    const redemptionRows = await db.select().from(threadCashEntries).where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
    ));
    expect(redemptionRows).toHaveLength(1);
  });

  it("20 parallel redemptions with the same idempotency key never double-spend", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);
    await db.insert(threadCashEntries).values({
      buyerId, amountCents: 1_000, source: "daily_checkin", referenceId: crypto.randomUUID(),
    });
    const idempotencyKey = crypto.randomUUID();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => redeemThreadCash(buyerId, 100, idempotencyKey)),
    );
    const uniqueTokens = new Set(results.map((r) => r.token));
    expect(uniqueTokens.size).toBe(1);

    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBe(900);
  });

  it("balance never goes negative under 20 parallel redemption attempts exceeding the balance", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);
    await db.insert(threadCashEntries).values({
      buyerId, amountCents: 500, source: "daily_checkin", referenceId: crypto.randomUUID(),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => redeemThreadCash(buyerId, 100, crypto.randomUUID())),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(5); // exactly balance / 100, never more

    const balance = await getBalanceCents(db, buyerId);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(0);
  });

  it("reserves one token for checkout, consumes it once, and allows a refund to return it", async () => {
    const buyerId = `thread-cash-test-${crypto.randomUUID()}`;
    const token = `TCASH-TEST-${crypto.randomUUID().toUpperCase()}`;
    const reservationId = `checkout:${crypto.randomUUID()}`;
    const checkoutRecordId = `cs_test_${crypto.randomUUID()}`;
    const orderId = crypto.randomUUID();
    testBuyerIds.push(buyerId);

    await db.insert(threadCashEntries).values({
      buyerId, amountCents: -250, source: "redemption", referenceId: token,
    });

    const reserved = await reserveThreadCashRedemption(buyerId, token, reservationId, 1_000);
    expect(reserved).toMatchObject({ token, discountCents: 250 });

    await expect(
      reserveThreadCashRedemption(buyerId, token, `checkout:${crypto.randomUUID()}`, 1_000),
    ).rejects.toMatchObject({ code: "THREAD_CASH_TOKEN_RESERVED" });

    await bindThreadCashRedemptionToCheckout(buyerId, token, reservationId, checkoutRecordId);
    await db.transaction((tx) => consumeThreadCashRedemption(tx, buyerId, token, checkoutRecordId, orderId));

    await expect(
      reserveThreadCashRedemption(buyerId, token, `checkout:${crypto.randomUUID()}`, 1_000),
    ).rejects.toMatchObject({ code: "THREAD_CASH_TOKEN_USED" });

    // A full refund of that order returns the spent Thread Cash exactly once,
    // even if the refund handler is retried.
    await db.transaction((tx) => refundThreadCashSpend(tx, buyerId, orderId, 250));
    await db.transaction((tx) => refundThreadCashSpend(tx, buyerId, orderId, 250));

    const balance = await getBalanceCents(db, buyerId);
    // -250 (redemption) + 250 (refund) = 0, and the refund only landed once.
    expect(balance).toBe(0);
    const refundRows = await db.select().from(threadCashEntries).where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "refund_credit"),
    ));
    expect(refundRows).toHaveLength(1);
  });
});
