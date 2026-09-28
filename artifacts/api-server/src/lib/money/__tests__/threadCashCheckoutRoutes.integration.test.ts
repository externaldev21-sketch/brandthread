/**
 * Item 109: Thread Cash at checkout through the real HTTP routes, the way
 * the app calls them:
 *
 *   POST /api/thread-cash/redeem → POST /api/buyer/checkout/session (with
 *   a seller promo code) → Stripe's paid webhook → the order and the
 *   seller's payout.
 *
 * Covers:
 *  - Thread Cash stacks after the promo code. Both go on one Stripe coupon,
 *    and the card is charged only the remainder;
 *  - the promo lowers the most Thread Cash an order can take, and the app's
 *    resize (cancel, then redeem the smaller amount) is accepted;
 *  - the seller is paid exactly what a card-only sale at the same promo
 *    price pays (the platform tops up the Thread Cash part);
 *  - cancelling returns the balance, including after the buyer abandoned
 *    Stripe's page (the open session is expired first). A paid session is
 *    never touched.
 * Real Postgres; Stripe is the in-memory fake.
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
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
// The checkout flag is OFF by default in production. These tests exercise
// the flow as it runs once an operator turns it on, without flipping the
// shared feature_flags row other test files read.
vi.mock("../../threadCash/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../threadCash/wallet")>()),
  isFeatureEnabled: async () => true,
}));

import { db, checkoutSessions, discountCodes, orders, shippingRates, threadCashEntries } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCheckoutPaid } from "../../../routes/webhooks";
import { getBalanceCents } from "../../threadCash/wallet";
import { call, expectLedgerBalanced, paidOut, pay, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";
import buyerRouter from "../../../routes/buyer";
import threadCashRouter from "../../../routes/thread-cash";

const PRICE = 5_000;
const SHIPPING = 1_200;
const PROMO = 1_000; // "TENOFF": $10 off, seller-funded

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/buyer", buyerRouter);
    server.use("/api/thread-cash", threadCashRouter);
  });
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => fake.reset());

async function seedShop(tag: string) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const product = await seedProduct(seller, { priceCents: PRICE });
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: seller, name: "Standard", flatRateCents: SHIPPING });
  const code = `TENOFF${uid("c").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
  await db.insert(discountCodes).values({ id: uid("dc"), sellerId: seller, code, type: "fixed", value: "10.00" });
  return { seller, buyer, product, code };
}

async function grant(buyer: string, cents: number) {
  await db.insert(threadCashEntries).values({ buyerId: buyer, amountCents: cents, source: "daily_checkin", referenceId: uid("grant") });
}

function checkoutBody(product: { productId: string; variantId: string }, extra: Record<string, unknown>) {
  return {
    items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }],
    successUrl: "https://brandthread.test/checkout/success",
    cancelUrl: "https://brandthread.test/checkout/cancel",
    contactEmail: "buyer@test.local",
    contactPhone: "+1 503 555 0100",
    shippingAddress: {
      recipientName: "Jordan Reyes", street: "148 Mercer Street", city: "New York",
      state: "NY", postalCode: "10012", country: "US", phone: "+1 503 555 0100",
    },
    clientIdempotencyKey: uid("idem"),
    ...extra,
  };
}

async function redeem(buyer: string, amountCents: number) {
  return call(app.base, "POST", "/api/thread-cash/redeem", buyer, { amountCents, idempotencyKey: uid("redeem") });
}

/** Stripe reports the session paid: the discount is the one coupon the route created. */
async function payStripeSession(sessionId: string) {
  const [checkout] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, sessionId)).limit(1);
  const couponCents = fake.state.coupons.at(-1)?.amount_off ?? 0;
  const session = fake.state.checkoutSessions.get(sessionId);
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = `pi_${uid("pi").replace(/-/g, "_")}`;
  session.amount_total = PRICE + SHIPPING - couponCents;
  session.total_details = { amount_tax: 0, amount_shipping: SHIPPING, amount_discount: couponCents };
  session.metadata = { ...session.metadata, csRef: checkout.id };
  await handleCheckoutPaid(session, `evt_${uid("paid")}`, new Date());
  const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  return order;
}

describe("Thread Cash at checkout (routes)", () => {
  it("stacks after a promo code, charges the card only the remainder, and pays the seller the same as a card-only sale", async () => {
    const { seller, buyer, product, code } = await seedShop("tc109-stack");
    await grant(buyer, 3_000);

    const redeemed = await redeem(buyer, 2_000);
    expect(redeemed.status).toBe(200);
    expect(await getBalanceCents(db, buyer)).toBe(1_000);

    const checkout = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { discountCode: code, threadCashToken: redeemed.body.token }));
    expect(checkout.status).toBe(200);

    // One coupon: promo + Thread Cash. Card = $62 − $10 − $20 = $32.
    expect(fake.state.coupons).toHaveLength(1);
    expect(fake.state.coupons[0].amount_off).toBe(PROMO + 2_000);
    expect(fake.state.coupons[0].name).toContain("Thread Cash");

    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, checkout.body.sessionId)).limit(1);
    expect(row.threadCashDiscountCents).toBe(2_000);
    expect(row.discountCodeAmountCents).toBe(PROMO);

    const order = await payStripeSession(checkout.body.sessionId);
    expect(order.grossChargedCents).toBe(PRICE + SHIPPING - PROMO - 2_000);
    expect(order.threadCashAppliedCents).toBe(2_000);
    expect(order.discountAmountCents).toBe(PROMO + 2_000);

    // The token is spent on this order and can't be reused.
    const [entry] = await db.select().from(threadCashEntries)
      .where(and(eq(threadCashEntries.buyerId, buyer), eq(threadCashEntries.referenceId, redeemed.body.token), eq(threadCashEntries.source, "redemption")));
    expect(entry.usedOrderId).toBe(order.id);

    // Platform top-up for exactly the Thread Cash part.
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "thread_cash_seller_topup").map((t) => t.amount)).toEqual([2_000]);

    // Control: the same order paid entirely by card with the same promo.
    const control = await seedSeller("tc109-control");
    const controlProduct = await seedProduct(control, { priceCents: PRICE });
    await pay({
      sellerId: control, buyerId: buyer, chargeModel: "destination", shippingCents: SHIPPING, discountCents: PROMO,
      items: [{ variantId: controlProduct.variantId, productName: controlProduct.productName, priceCents: PRICE, quantity: 1 }],
    });
    expect(await paidOut(seller)).toBe(await paidOut(control));
    // The seller's order screen (mobile lib/threadCashCheckout.ts
    // sellerThreadCashPayout) adds up exactly these order fields:
    // card + Thread Cash − Brandthread fee − processing = the ledger payout.
    const [stored] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
    expect(stored.totalCents + stored.threadCashAppliedCents - stored.platformFeeCents - stored.processingFeeChargedCents)
      .toBe(await paidOut(seller));
    await expectLedgerBalanced();
  });

  it("a promo lowers the ceiling: an oversized token is refused, and the app's resize (cancel + smaller redeem) goes through", async () => {
    const { buyer, product, code } = await seedShop("tc109-resize");
    await grant(buyer, 6_000);

    // $62 order − $10 promo − 50¢ card minimum = $51.50 most Thread Cash.
    const ceiling = PRICE + SHIPPING - PROMO - 50;
    const tooBig = await redeem(buyer, ceiling + 1);
    const refused = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { discountCode: code, threadCashToken: tooBig.body.token }));
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("THREAD_CASH_DISCOUNT_TOO_LARGE");

    const cancelled = await call(app.base, "POST", `/api/thread-cash/redeem/${tooBig.body.token}/cancel`, buyer, {});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.returnedCents).toBe(ceiling + 1);
    expect(await getBalanceCents(db, buyer)).toBe(6_000);

    const fitted = await redeem(buyer, ceiling);
    const accepted = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { discountCode: code, threadCashToken: fitted.body.token }));
    expect(accepted.status).toBe(200);
    expect(fake.state.coupons.at(-1).amount_off).toBe(PROMO + ceiling); // card is left with exactly 50¢
  });

  it("cancelling after an abandoned payment expires the unpaid session and returns the balance; a paid one is never touched", async () => {
    const { buyer, product } = await seedShop("tc109-abandon");
    await grant(buyer, 2_500);

    const redeemed = await redeem(buyer, 1_500);
    const first = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { threadCashToken: redeemed.body.token }));
    expect(first.status).toBe(200);

    // The buyer closes Stripe's page and turns the toggle off.
    const cancelled = await call(app.base, "POST", `/api/thread-cash/redeem/${redeemed.body.token}/cancel`, buyer, {});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ returnedCents: 1_500, balanceCents: 2_500 });
    expect(fake.state.checkoutSessions.get(first.body.sessionId).status).toBe("expired");
    // Idempotent: a retried cancel credits nothing more.
    const again = await call(app.base, "POST", `/api/thread-cash/redeem/${redeemed.body.token}/cancel`, buyer, {});
    expect(again.status).toBe(200);
    expect(await getBalanceCents(db, buyer)).toBe(2_500);

    // A paid session keeps its Thread Cash.
    const second = await redeem(buyer, 1_000);
    const paidCheckout = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { threadCashToken: second.body.token }));
    const order = await payStripeSession(paidCheckout.body.sessionId);
    expect(order.threadCashAppliedCents).toBe(1_000);
    const refused = await call(app.base, "POST", `/api/thread-cash/redeem/${second.body.token}/cancel`, buyer, {});
    expect(refused.status).toBe(409);
    expect(await getBalanceCents(db, buyer)).toBe(1_500);
  });

  it("changing the order after an abandoned payment: a new checkout takes the same token over", async () => {
    const { buyer, product, code } = await seedShop("tc109-retake");
    await grant(buyer, 2_000);
    const redeemed = await redeem(buyer, 1_000);

    const abandoned = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { threadCashToken: redeemed.body.token }));
    expect(abandoned.status).toBe(200);

    // New idempotency key (the app starts a new attempt when the order changes).
    const retaken = await call(app.base, "POST", "/api/buyer/checkout/session", buyer,
      checkoutBody(product, { threadCashToken: redeemed.body.token, discountCode: code }));
    expect(retaken.status).toBe(200);
    expect(retaken.body.sessionId).not.toBe(abandoned.body.sessionId);
    expect(fake.state.checkoutSessions.get(abandoned.body.sessionId).status).toBe("expired");
    expect(fake.state.coupons.at(-1).amount_off).toBe(PROMO + 1_000);
  });

  it("another buyer can't cancel (or free) someone else's token", async () => {
    const { buyer, product } = await seedShop("tc109-owner");
    const stranger = await seedBuyer("tc109-stranger");
    await grant(buyer, 1_000);
    const redeemed = await redeem(buyer, 800);
    await call(app.base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(product, { threadCashToken: redeemed.body.token }));

    const attempt = await call(app.base, "POST", `/api/thread-cash/redeem/${redeemed.body.token}/cancel`, stranger, {});
    expect(attempt.status).toBe(404);
    expect(await getBalanceCents(db, buyer)).toBe(200);
    expect([...fake.state.checkoutSessions.values()].every((s) => s.status === "open")).toBe(true);
  });
});
