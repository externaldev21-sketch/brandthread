/**
 * Thread Cash with PAYOUT_MODE=hold (the default): in-stock orders use the
 * 'transfer' charge model, so the card charge lands on Brandthread's balance
 * and the seller is paid only after delivery + buffer. Thread Cash is a
 * platform-funded discount: when the order is released the seller must
 * receive the FULL pre-Thread-Cash price minus the platform fee and
 * processing — the card-funded transfer plus a thread_cash_seller_topup
 * transfer — and not a cent before release (revenue audit BT-108).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { accountBalanceCents } from "../ledger";
import { settleTransferOrder } from "../cartTransfers";
import { handleCheckoutPaid } from "../../../routes/webhooks";
import { expectLedgerBalanced, orderLedger, paidOut, reloadOrder, seedBuyer, seedProduct, seedSeller, uid } from "./moneyHarness";
import { bindThreadCashRedemptionToCheckout, redeemThreadCash, reserveThreadCashRedemption } from "../../threadCash/wallet";
import { sweepThreadCashSellerTopups } from "../../threadCash/checkoutTopup";

let previousMode: string | undefined;
beforeAll(() => {
  previousMode = process.env.PAYOUT_MODE;
  process.env.PAYOUT_MODE = "hold";
});
afterAll(async () => {
  if (previousMode === undefined) delete process.env.PAYOUT_MODE;
  else process.env.PAYOUT_MODE = previousMode;
  await expectLedgerBalanced();
});
beforeEach(() => fake.reset());

async function payTransferOrderWithThreadCash(input: { priceCents: number; threadCashCents: number }) {
  const seller = await seedSeller("tc-hold");
  const buyer = await seedBuyer("tc-hold");
  const product = await seedProduct(seller, { priceCents: input.priceCents });
  await db.insert(threadCashEntries).values({
    buyerId: buyer, amountCents: input.threadCashCents, source: "daily_checkin", referenceId: uid("grant"),
  });
  const redemption = await redeemThreadCash(buyer, input.threadCashCents, uid("redeem"));
  // No shipping on this order (the fee base is item + shipping).
  const feeInput = { merchandiseCents: input.priceCents, shippingCents: 0, preTaxTotalCents: input.priceCents };
  const fee = destinationApplicationFeeCents(feeInput);
  const reservationId = `checkout:${uid("reservation")}`;
  await reserveThreadCashRedemption(buyer, redemption.token, reservationId, input.priceCents, 1);
  const [checkout] = await db.insert(checkoutSessions).values({
    buyerId: buyer,
    sellerId: seller,
    items: [{ variantId: product.variantId, productName: product.productName, variantLabel: "M", quantity: 1, priceCents: input.priceCents }],
    chargeModel: "transfer",
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
    threadCashToken: redemption.token,
    threadCashDiscountCents: redemption.discountCents,
  }).returning();
  await bindThreadCashRedemptionToCheckout(buyer, redemption.token, reservationId, checkout.id);

  const sessionId = `cs_${uid("session").replace(/-/g, "_")}`;
  const paymentIntentId = `pi_${uid("pi").replace(/-/g, "_")}`;
  fake.state.chargeFees.set(paymentIntentId, null);
  await db.update(checkoutSessions).set({ stripeSessionId: sessionId }).where(eq(checkoutSessions.id, checkout.id));
  await handleCheckoutPaid({
    id: sessionId,
    payment_intent: paymentIntentId,
    payment_status: "paid",
    amount_total: input.priceCents - input.threadCashCents,
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: input.threadCashCents },
    metadata: { csRef: checkout.id },
  } as any, `evt_${uid("paid")}`, new Date());
  const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  if (!order) throw new Error("checkout did not create an order");
  return { seller, buyer, order, fee };
}

/** Delivered long enough ago that the hold has passed. */
async function deliver(orderId: string) {
  const past = new Date(Date.now() - 10 * 86_400_000);
  await db.update(orders).set({ deliveredAt: past, payoutReleaseAt: past }).where(eq(orders.id, orderId));
}

describe("Thread Cash checkout with PAYOUT_MODE=hold (transfer charges)", () => {
  it("pays the seller the full pre-Thread-Cash price minus fees, only once the order is released", async () => {
    const { seller, order, fee } = await payTransferOrderWithThreadCash({ priceCents: 5_000, threadCashCents: 1_000 });

    expect(order.chargeModel).toBe("transfer");
    expect(order.threadCashAppliedCents).toBe(1_000);
    expect(order.grossChargedCents).toBe(4_000);
    expect(order.platformFeeCents).toBe(fee.platformFeeCents); // fee basis = full price

    // Held: nothing has reached the seller yet — not the card part, not the top-up.
    expect(await paidOut(seller)).toBe(0);
    expect(fake.state.transfers).toHaveLength(0);

    await deliver(order.id);
    expect(await settleTransferOrder(order.id, { stripe: fake.stripe as any })).toBe("transferred");

    const released = await reloadOrder(order.id);
    const expectedSellerNet = 5_000 - fee.platformFeeCents - released.processingFeeCents;
    // Seller net = full price − platform fee − processing, as if paid by card.
    expect(await paidOut(seller)).toBe(expectedSellerNet);
    expect(released.sellerNetCents + released.threadCashAppliedCents).toBe(expectedSellerNet);
    expect(released.stripeThreadCashTransferId).toBeTruthy();
    expect(fake.state.transfers.map((t) => t.metadata?.kind ?? null).sort())
      .toEqual(["cart_order_transfer", "thread_cash_seller_topup"]);

    // Ledger: the top-up is a platform expense, and the spend cleared the
    // Thread Cash liability for exactly the amount applied.
    const ledger = await orderLedger(order.id);
    expect(ledger.seller_paid_out).toBe(expectedSellerNet);
    expect(ledger.thread_cash_liability).toBe(-1_000);
    expect(ledger.thread_cash_seller_topup ?? 0).toBe(0); // spend +1000, top-up −1000
    await expectLedgerBalanced();
  });

  it("never pays the top-up twice (re-settle, sweep, webhook replay)", async () => {
    const { seller, order } = await payTransferOrderWithThreadCash({ priceCents: 3_000, threadCashCents: 500 });
    await deliver(order.id);
    await settleTransferOrder(order.id, { stripe: fake.stripe as any });
    const after = await paidOut(seller);

    expect(await settleTransferOrder(order.id, { stripe: fake.stripe as any })).toBe("already");
    await sweepThreadCashSellerTopups(fake.stripe as any);
    expect(await paidOut(seller)).toBe(after);
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "thread_cash_seller_topup")).toHaveLength(1);
  });

  it("the sweep retries a top-up that failed when the order was released", async () => {
    const { seller, order, fee } = await payTransferOrderWithThreadCash({ priceCents: 4_000, threadCashCents: 800 });
    await deliver(order.id);
    // The order transfer succeeds; the top-up right after it fails.
    const original = fake.stripe.transfers.create.bind(fake.stripe.transfers);
    let failTopup = true;
    const spy = vi.spyOn(fake.stripe.transfers, "create").mockImplementation(async (params: any, options: any) => {
      if (params?.metadata?.kind === "thread_cash_seller_topup" && failTopup) {
        failTopup = false;
        throw new Error("stripe down");
      }
      return original(params, options);
    });
    try {
      await settleTransferOrder(order.id, { stripe: fake.stripe as any });
      expect((await reloadOrder(order.id)).stripeThreadCashTransferId).toBeNull();

      await sweepThreadCashSellerTopups(fake.stripe as any);
    } finally {
      spy.mockRestore();
    }
    const released = await reloadOrder(order.id);
    expect(released.stripeThreadCashTransferId).toBeTruthy();
    expect(await paidOut(seller)).toBe(4_000 - fee.platformFeeCents - released.processingFeeCents);
    expect(await accountBalanceCents(db, { account: "seller_paid_out", partyId: seller, orderId: order.id }))
      .toBe(4_000 - fee.platformFeeCents - released.processingFeeCents);
  });
});
