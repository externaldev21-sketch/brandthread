/**
 * Thread Cash at checkout, end to end: balance -> redeem -> apply as a
 * checkout discount -> order created with the discount recorded -> seller
 * still paid the FULL item price via a platform-funded supplemental
 * transfer -> a full refund/cancellation claws back both the card refund
 * and that supplemental transfer, and returns the Thread Cash exactly once.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));

import { db, checkoutSessions, threadCashEntries, orders } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { destinationApplicationFeeCents } from "../fees";
import { handleCheckoutPaid } from "../../../routes/webhooks";
import { expectLedgerBalanced, paidOut, seedBuyer, seedProduct, seedSeller, uid } from "./moneyHarness";
import { bindThreadCashRedemptionToCheckout, getBalanceCents, redeemThreadCash, reserveThreadCashRedemption } from "../../threadCash/wallet";
import { refundOrder } from "../refunds";

beforeEach(() => fake.reset());
afterAll(async () => {
  await expectLedgerBalanced();
});

async function payWithThreadCash(input: {
  sellerId: string; buyerId: string;
  priceCents: number; quantity: number; threadCashDiscountCents: number;
}) {
  const product = await seedProduct(input.sellerId, { priceCents: input.priceCents });
  const subtotal = input.priceCents * input.quantity;

  await db.insert(threadCashEntries).values({
    buyerId: input.buyerId, amountCents: subtotal, source: "daily_checkin", referenceId: uid("grant"),
  });
  const redemption = await redeemThreadCash(input.buyerId, input.threadCashDiscountCents, uid("redeem"));

  // Fee basis is computed on the FULL price — Thread Cash never reduces it.
  const fee = destinationApplicationFeeCents({ merchandiseCents: subtotal, preTaxTotalCents: subtotal });

  // Mirrors routes/buyer.ts: reserve the token to this checkout attempt
  // BEFORE the checkout row is created, then bind it to the row's id, so
  // the webhook's consumeThreadCashRedemption finds a matching reservation.
  const reservationId = `checkout:${uid("reservation")}`;
  await reserveThreadCashRedemption(input.buyerId, redemption.token, reservationId, subtotal, 1);

  const [checkout] = await db.insert(checkoutSessions).values({
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    items: [{ variantId: product.variantId, productName: product.productName, variantLabel: "M", quantity: input.quantity, priceCents: input.priceCents }],
    chargeModel: "destination",
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
    threadCashToken: redemption.token,
    threadCashDiscountCents: redemption.discountCents,
  }).returning();
  await bindThreadCashRedemptionToCheckout(input.buyerId, redemption.token, reservationId, checkout.id);

  const sessionId = `cs_${uid("session").replace(/-/g, "_")}`;
  const paymentIntentId = `pi_${uid("pi").replace(/-/g, "_")}`;
  const chargedCents = subtotal - input.threadCashDiscountCents;
  fake.state.chargeFees.set(paymentIntentId, null);
  await db.update(checkoutSessions).set({ stripeSessionId: sessionId }).where(eq(checkoutSessions.id, checkout.id));
  const session = {
    id: sessionId,
    payment_intent: paymentIntentId,
    payment_status: "paid",
    amount_total: chargedCents,
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: input.threadCashDiscountCents },
    metadata: { csRef: checkout.id },
  };
  await handleCheckoutPaid(session as any, `evt_${uid("paid")}`, new Date());
  const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  if (!order) throw new Error("checkout did not create an order");
  return { order, fee, subtotal };
}

describe("Thread Cash checkout discount", () => {
  it("discounts the card charge without reducing the seller's payout", async () => {
    const seller = await seedSeller("tc");
    const buyer = await seedBuyer("tc");

    const { order, fee, subtotal } = await payWithThreadCash({
      sellerId: seller, buyerId: buyer, priceCents: 5_000, quantity: 1, threadCashDiscountCents: 1_000,
    });

    expect(order.threadCashAppliedCents).toBe(1_000);
    expect(order.grossChargedCents).toBe(4_000); // card charged $40 of the $50 item
    expect(order.platformFeeCents).toBe(fee.platformFeeCents); // fee basis unaffected by Thread Cash

    // Balance already reflects the spend (redeemed before checkout).
    expect(await getBalanceCents(db, buyer)).toBe(subtotal - 1_000);

    // The seller's total payout — the reduced card-funded transfer PLUS the
    // platform-funded top-up — equals exactly what a full-price sale would
    // have paid them (fees computed on the same full, undiscounted price).
    const expectedFullPricePayout = subtotal - fee.platformFeeCents - order.processingFeeCents;
    expect(await paidOut(seller)).toBe(expectedFullPricePayout);
    expect(order.stripeThreadCashTransferId).toBeTruthy();
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0].amount).toBe(1_000);

    await expectLedgerBalanced();
  });

  it("is idempotent under a replayed webhook — no double top-up", async () => {
    const seller = await seedSeller("tc-replay");
    const buyer = await seedBuyer("tc-replay");
    const { order } = await payWithThreadCash({
      sellerId: seller, buyerId: buyer, priceCents: 5_000, quantity: 1, threadCashDiscountCents: 500,
    });
    const payoutAfterFirst = await paidOut(seller);

    // Simulate Stripe redelivering the same event: handleCheckoutPaid's own
    // fast-path (existing order) re-runs applyThreadCashSellerTopup, which
    // must no-op once the transfer is already recorded.
    const [checkout] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.buyerId, buyer)).limit(1);
    await handleCheckoutPaid({
      id: order.stripeCheckoutSessionId, payment_intent: order.stripePaymentIntentId, payment_status: "paid",
      amount_total: order.grossChargedCents, total_details: { amount_discount: 500 },
      metadata: { csRef: checkout.id },
    } as any, `evt_${uid("replay")}`, new Date());

    expect(await paidOut(seller)).toBe(payoutAfterFirst);
    expect(fake.state.transfers).toHaveLength(1);
    await expectLedgerBalanced();
  });

  it("a full refund claws back the card charge, reverses the top-up, and returns Thread Cash exactly once", async () => {
    const seller = await seedSeller("tc-refund", { stripeAccount: true });
    const buyer = await seedBuyer("tc-refund");
    const { order } = await payWithThreadCash({
      sellerId: seller, buyerId: buyer, priceCents: 5_000, quantity: 1, threadCashDiscountCents: 1_000,
    });
    const balanceAfterSpend = await getBalanceCents(db, buyer);

    await refundOrder({
      orderId: order.id,
      reason: "buyer_cancelled",
      initiatedBy: buyer,
      idempotencyKey: uid("refund"),
      cancelOrder: { reason: "buyer_cancelled", notes: null, restock: true },
    });

    // Retrying the same refund (e.g. a client retry) must not double-credit.
    await refundOrder({
      orderId: order.id,
      reason: "buyer_cancelled",
      initiatedBy: buyer,
      idempotencyKey: uid("refund"), // different key, but order is already fully refunded
    }).catch(() => {}); // expected to reject (ALREADY_REFUNDED) — the assertion below is what matters

    expect(await getBalanceCents(db, buyer)).toBe(balanceAfterSpend + 1_000);
    expect(fake.state.reversals.some((r) => r.transfer === order.stripeThreadCashTransferId)).toBe(true);
    // The seller keeps nothing for a fully refunded order: their net payout
    // settles to exactly minus Stripe's (non-refundable) processing fee —
    // the only cost that legitimately stays with the seller on a full
    // refund, per the documented refund rules in lib/money/refunds.ts.
    expect(await paidOut(seller)).toBe(-order.processingFeeChargedCents);
    await expectLedgerBalanced();
  });
});
