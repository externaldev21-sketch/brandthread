/**
 * Loyalty awards must remain correct when Stripe retries or concurrently
 * delivers the same paid-order event.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  checkoutSessions,
  db,
  loyaltyPoints,
  notificationsFeed,
  orders,
  productVariants,
  products,
  sellerTaxLedger,
  users,
} from "@workspace/db";
import {
  awardLoyaltyPointsOnce,
  bindLoyaltyRedemptionToCheckout,
  consumeLoyaltyRedemption,
  redeemLoyaltyPoints,
  reserveLoyaltyRedemption,
  reversePurchasePointsOnce,
} from "../loyalty";
import { handleCheckoutPaid } from "../webhooks";

const fakeStripe = vi.hoisted(() => ({
  refunds: {
    create: vi.fn(async () => ({ id: "re_loyalty_awards_test" })),
  },
}));

vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return {
    ...real,
    stripe: fakeStripe,
    STRIPE_WEBHOOK_SECRET: "whsec_loyalty_awards_test",
  };
});

const testBuyerIds: string[] = [];
const testSellerIds: string[] = [];
const testProductIds: string[] = [];
const testCheckoutIds: string[] = [];
const testStripeSessionIds: string[] = [];

afterEach(async () => {
  while (testBuyerIds.length > 0) {
    const buyerId = testBuyerIds.pop()!;
    await db.delete(loyaltyPoints).where(eq(loyaltyPoints.buyerId, buyerId));
    await db.delete(orders).where(eq(orders.buyerId, buyerId));
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, buyerId));
  }
  while (testStripeSessionIds.length > 0) {
    const stripeSessionId = testStripeSessionIds.pop()!;
    await db.delete(orders).where(eq(orders.stripeCheckoutSessionId, stripeSessionId));
  }
  while (testCheckoutIds.length > 0) {
    await db.delete(checkoutSessions).where(eq(checkoutSessions.id, testCheckoutIds.pop()!));
  }
  while (testProductIds.length > 0) {
    await db.delete(products).where(eq(products.id, testProductIds.pop()!));
  }
  while (testSellerIds.length > 0) {
    const sellerId = testSellerIds.pop()!;
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
    await db.delete(users).where(eq(users.clerkId, sellerId));
  }
  fakeStripe.refunds.create.mockClear();
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

type PaidCartFixture = {
  buyerId: string;
  sellerId: string;
  totalCents: number;
  sessionId: string;
  orderItem: {
    variantId: string;
    productName: string;
    variantLabel: string;
    quantity: number;
    priceCents: number;
  };
};

async function seedPaidCartFixture(options: { stock: number; totalCents: number; guest?: boolean }): Promise<PaidCartFixture> {
  const buyerId = `loyalty-checkout-buyer-${crypto.randomUUID()}`;
  const sellerId = `loyalty-checkout-seller-${crypto.randomUUID()}`;
  const productName = "Paid checkout loyalty test product";
  const sessionId = `cs_loyalty_test_${crypto.randomUUID()}`;

  await db.insert(users).values([
    {
      clerkId: buyerId,
      email: `${buyerId}@test.local`,
      name: "Loyalty Checkout Buyer",
      role: "buyer",
      accountType: "buyer",
    },
    {
      clerkId: sellerId,
      email: `${sellerId}@test.local`,
      name: "Loyalty Checkout Seller",
      role: "seller",
      accountType: "seller",
    },
  ]);
  testBuyerIds.push(buyerId);
  testSellerIds.push(sellerId);

  const [product] = await db
    .insert(products)
    .values({
      ownerId: sellerId,
      name: productName,
      category: "apparel",
      status: "active",
    })
    .returning({ id: products.id });
  testProductIds.push(product.id);

  const [variant] = await db
    .insert(productVariants)
    .values({
      productId: product.id,
      sku: `loyalty-checkout-${crypto.randomUUID()}`,
      priceCents: options.totalCents,
      stock: options.stock,
      size: "M",
      color: "Black",
    })
    .returning({ id: productVariants.id });

  const orderItem = {
    variantId: variant.id,
    productName,
    variantLabel: "M / Black",
    quantity: 1,
    priceCents: options.totalCents,
  };
  const [checkout] = await db
    .insert(checkoutSessions)
    .values({
      stripeSessionId: sessionId,
      buyerId: options.guest ? null : buyerId,
      ...(options.guest ? { guestEmail: `${buyerId}@guest.test` } : {}),
      sellerId,
      items: [orderItem],
    })
    .returning({ id: checkoutSessions.id });
  testCheckoutIds.push(checkout.id);
  testStripeSessionIds.push(sessionId);

  return { buyerId, sellerId, totalCents: options.totalCents, sessionId, orderItem };
}

describe("paid cart checkout rewards", () => {
  it("persists authoritative tax, shipping, gross charge, and one guest ledger row across retries and refunds", async () => {
    const fixture = await seedPaidCartFixture({ stock: 2, totalCents: 10_000, guest: true });
    const successfulPaymentAt = new Date("2025-01-01T00:00:02.000Z");
    const session = {
      id: fixture.sessionId,
      payment_intent: "pi_tax_ledger_guest",
      payment_status: "paid",
      amount_total: 11_250,
      total_details: {
        amount_discount: 0,
        amount_shipping: 500,
        amount_tax: 750,
      },
      shipping_details: {
        name: "Final Guest Destination",
        address: {
          line1: "900 Final Tax Avenue",
          line2: "Suite 2",
          city: "Vancouver",
          state: "BC",
          postal_code: "V6B 1A1",
          country: "CA",
        },
      },
      metadata: {},
    };

    await handleCheckoutPaid(session, "evt_tax_ledger_guest", successfulPaymentAt);
    await handleCheckoutPaid(session, "evt_tax_ledger_guest_retry", successfulPaymentAt);

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.stripeCheckoutSessionId, fixture.sessionId))
      .limit(1);
    expect(order).toMatchObject({
      buyerId: null,
      subtotalCents: 10_000,
      shippingCents: 500,
      taxCents: 750,
      totalCents: 11_250,
      grossChargedCents: 11_250,
      paidAt: successfulPaymentAt,
      shippingAddress: {
        name: "Final Guest Destination",
        street: "900 Final Tax Avenue",
        line2: "Suite 2",
        city: "Vancouver",
        state: "BC",
        zip: "V6B 1A1",
        country: "CA",
      },
    });

    const ledgerRows = await db
      .select()
      .from(sellerTaxLedger)
      .where(eq(sellerTaxLedger.orderId, order.id));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      sellerId: fixture.sellerId,
      grossPaymentCents: 11_250,
      taxCents: 750,
      shippingCents: 500,
      stripePaymentIntentId: "pi_tax_ledger_guest",
      stripeCheckoutSessionId: fixture.sessionId,
      calendarYear: 2025,
      paidAt: successfulPaymentAt,
      paidAtSource: "stripe_event",
    });

    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    const afterRefund = await db
      .select()
      .from(sellerTaxLedger)
      .where(eq(sellerTaxLedger.orderId, order.id));
    expect(afterRefund).toHaveLength(1);
    expect(afterRefund[0]?.grossPaymentCents).toBe(11_250);
  });

  it("awards floor(totalCents / 100) once through the paid Checkout Session handler", async () => {
    const fixture = await seedPaidCartFixture({ stock: 2, totalCents: 12_399 });
    const session = {
      id: fixture.sessionId,
      payment_intent: "pi_loyalty_awards_paid",
      payment_status: "paid",
      amount_total: fixture.totalCents,
      metadata: {},
    };

    await handleCheckoutPaid(session, "evt_loyalty_awards_paid");
    await handleCheckoutPaid(session, "evt_loyalty_awards_paid_retry");

    const [order] = await db
      .select({ id: orders.id, status: orders.status, totalCents: orders.totalCents })
      .from(orders)
      .where(eq(orders.stripeCheckoutSessionId, fixture.sessionId))
      .limit(1);
    expect(order).toMatchObject({
      status: "pending",
      totalCents: fixture.totalCents,
    });

    const rewards = await db
      .select()
      .from(loyaltyPoints)
      .where(and(
        eq(loyaltyPoints.buyerId, fixture.buyerId),
        eq(loyaltyPoints.source, "order_earn"),
        eq(loyaltyPoints.referenceId, order.id),
      ));
    expect(rewards).toHaveLength(1);
    expect(rewards[0]?.points).toBe(Math.floor(fixture.totalCents / 100));
  });

  it("does not award points to an oversold refund_pending order, including on replay", async () => {
    const fixture = await seedPaidCartFixture({ stock: 0, totalCents: 12_399 });
    const session = {
      id: fixture.sessionId,
      payment_intent: "pi_loyalty_awards_oversold",
      payment_status: "paid",
      amount_total: fixture.totalCents,
      metadata: {},
    };

    await handleCheckoutPaid(session, "evt_loyalty_awards_oversold");
    await handleCheckoutPaid(session, "evt_loyalty_awards_oversold_retry");

    const [order] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.stripeCheckoutSessionId, fixture.sessionId))
      .limit(1);
    expect(order?.status).toBe("refund_pending");

    const rewards = await db
      .select()
      .from(loyaltyPoints)
      .where(and(
        eq(loyaltyPoints.buyerId, fixture.buyerId),
        eq(loyaltyPoints.source, "order_earn"),
        eq(loyaltyPoints.referenceId, order.id),
      ));
    expect(rewards).toHaveLength(0);
    expect(fakeStripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});

describe("loyalty checkout redemptions", () => {
  it("serializes concurrent redemptions so deductions cannot exceed the balance", async () => {
    const buyerId = `loyalty-test-${crypto.randomUUID()}`;
    testBuyerIds.push(buyerId);

    await db.insert(loyaltyPoints).values({
      buyerId,
      points: 150,
      source: "bonus",
      referenceId: crypto.randomUUID(),
      note: "Test redemption balance",
    });

    const attempts = await Promise.allSettled([
      redeemLoyaltyPoints(buyerId, 100),
      redeemLoyaltyPoints(buyerId, 100),
    ]);
    const successful = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof redeemLoyaltyPoints>>> =>
        attempt.status === "fulfilled",
    );
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(successful[0]?.value).toMatchObject({
      pointsUsed: 100,
      discountCents: 100,
    });
    expect(successful[0]?.value.token).toMatch(/^LOYAL-/);
    expect(rejected[0]).toMatchObject({
      reason: { code: "INSUFFICIENT_POINTS" },
    });

    const [balance] = await db
      .select({ total: sql<number>`COALESCE(SUM(${loyaltyPoints.points}), 0)` })
      .from(loyaltyPoints)
      .where(eq(loyaltyPoints.buyerId, buyerId));
    expect(Number(balance?.total ?? 0)).toBe(50);
  });

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