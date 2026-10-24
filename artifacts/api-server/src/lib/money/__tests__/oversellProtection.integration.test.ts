/**
 * LIVE oversell protection: two buyers grabbing the last unit at the same
 * moment. Every buy path claims the stock atomically BEFORE any payment can
 * be taken, so the loser gets a clean 409 SOLD_OUT and is never charged:
 *
 *  - hosted Stripe Checkout (POST /api/buyer/checkout/session), the normal
 *    checkout and the fallback the LIVE overlay's "Buy" uses;
 *  - the same, from a LIVE (live-only code + liveStreamId);
 *  - in-app one-page checkout from a LIVE (POST /api/buyer/checkout/payment-intent);
 *  - guest hosted checkout (POST /api/guest/checkout/session).
 *
 * Each race fires both purchases concurrently (Promise.all) at stock = 1 and
 * asserts exactly one succeeds, exactly one Stripe payment object exists
 * (zero double-charges), and the paid webhook turns the hold into the order
 * without a second decrement or a refund. Holds that lapse go back on sale.
 * Real Postgres; Stripe is the in-memory fake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// routes/guest-checkout.ts reads its token secret at import.
vi.hoisted(() => { process.env.SESSION_SECRET ||= "oversell-protection-test-secret"; });

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
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

import { db, checkoutSessions, discountCodes, liveStreams, orders, productVariants } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded, handleCheckoutPaid } from "../../../routes/webhooks";
import buyerRouter from "../../../routes/buyer";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import guestCheckoutRouter from "../../../routes/guest-checkout";
import webhooksRouter from "../../../routes/webhooks";
import { expireStockReservations } from "../cartTransfers";
import { HOSTED_STOCK_RESERVATION_TTL_MS } from "../stockReservation";
import { call, expectLedgerBalanced, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

const PRICE = 4_000;

let app: Awaited<ReturnType<typeof startApp>>;
const originalKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  app = await startApp((server) => {
    // Mounted like routes/index.ts: the payment-intent router before the buyer router.
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use("/api/buyer", buyerRouter);
    server.use("/api/guest/checkout", guestCheckoutRouter);
    server.use("/api/webhooks", webhooksRouter);
  });
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => fake.reset());

async function stockOf(variantId: string): Promise<number> {
  const [row] = await db.select({ stock: productVariants.stock }).from(productVariants)
    .where(eq(productVariants.id, variantId)).limit(1);
  return row.stock;
}

async function holdsFor(variantId: string) {
  const result = await db.execute(sql`
    SELECT status, quantity FROM stock_reservations WHERE variant_id = ${variantId}::uuid
  `);
  return result.rows as Array<{ status: string; quantity: number }>;
}

/** One seller live right now, a last-unit product, and a live-only code for it. */
async function seedLiveDrop(tag: string) {
  const seller = await seedSeller(tag);
  const product = await seedProduct(seller, { priceCents: PRICE, stock: 1 });
  const [stream] = await db.insert(liveStreams).values({
    sellerId: seller, channelName: uid("chan"), title: "Friday drop", status: "live",
  }).returning();
  const code = `LIVE${uid("c").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
  await db.insert(discountCodes).values({
    id: uid("dc"), sellerId: seller, code, type: "fixed", value: "5.00", liveStreamId: stream.id,
  });
  return { seller, product, streamId: stream.id, code };
}

const shipTo = {
  recipientName: "Jordan Reyes", street: "148 Mercer Street", city: "New York",
  state: "NY", postalCode: "10012", country: "US",
};

function hostedBody(product: { productId: string; variantId: string }, extra: Record<string, unknown> = {}) {
  return {
    items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }],
    successUrl: "https://brandthread.test/checkout/success",
    cancelUrl: "https://brandthread.test/checkout/cancel",
    contactEmail: "buyer@test.local",
    contactPhone: "+1 503 555 0100",
    shippingAddress: { ...shipTo, phone: "+1 503 555 0100" },
    clientIdempotencyKey: uid("idem"),
    ...extra,
  };
}

/** Both buyers tap Buy at the same instant. */
async function race<T extends { status: number; body: any }>(attempts: Array<() => Promise<T>>) {
  const results = await Promise.all(attempts.map((attempt) => attempt()));
  const winners = results.filter((r) => r.status === 200 || r.status === 201);
  const losers = results.filter((r) => r.status === 409);
  return { results, winners, losers };
}

function expectCleanSoldOut(loser: { body: any }, variantId: string) {
  expect(loser.body).toMatchObject({ code: "SOLD_OUT", variantId });
  expect(loser.body.error).toMatch(/just sold out/);
}

/** Stripe reports a hosted session paid. */
async function payHostedSession(sessionId: string, amountTotal: number) {
  const [checkout] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, sessionId)).limit(1);
  const session = fake.state.checkoutSessions.get(sessionId);
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = `pi_${uid("pi").replace(/-/g, "_")}`;
  session.amount_total = amountTotal;
  session.total_details = { amount_tax: 0, amount_shipping: 0, amount_discount: Math.max(0, PRICE - amountTotal) };
  session.metadata = { ...session.metadata, csRef: checkout.id };
  await handleCheckoutPaid(session, `evt_${uid("paid")}`, new Date());
  const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  return order;
}

describe("oversell protection: two buyers, one unit", () => {
  it("hosted checkout: exactly one buyer gets a Stripe session, the other SOLD_OUT before any charge", async () => {
    const seller = await seedSeller("os-hosted");
    const [buyerA, buyerB] = await Promise.all([seedBuyer("os-hosted-a"), seedBuyer("os-hosted-b")]);
    const product = await seedProduct(seller, { priceCents: PRICE, stock: 1 });

    const { winners, losers } = await race([
      () => call(app.base, "POST", "/api/buyer/checkout/session", buyerA, hostedBody(product)),
      () => call(app.base, "POST", "/api/buyer/checkout/session", buyerB, hostedBody(product)),
    ]);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expectCleanSoldOut(losers[0], product.variantId);
    // The loser never reached Stripe: one session = at most one charge.
    expect(fake.state.checkoutSessionCreates).toHaveLength(1);
    // The unit is out of stock while the winner pays, and the session closes before the hold lapses.
    expect(await stockOf(product.variantId)).toBe(0);
    expect(await holdsFor(product.variantId)).toEqual([{ status: "held", quantity: 1 }]);
    const expiresAt = fake.state.checkoutSessionCreates[0].params.expires_at as number;
    expect(expiresAt * 1000).toBeGreaterThanOrEqual(Date.now() + 30 * 60_000);

    // Paid: the hold becomes the order. No second decrement, no refund.
    const order = await payHostedSession(winners[0].body.sessionId, PRICE);
    expect(order.status).toBe("processing");
    expect(await stockOf(product.variantId)).toBe(0);
    expect(await holdsFor(product.variantId)).toEqual([{ status: "committed", quantity: 1 }]);
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("LIVE buy (live-only code + liveStreamId) on hosted checkout: one winner, one SOLD_OUT, zero double-charges", async () => {
    const live = await seedLiveDrop("os-live-hosted");
    const [buyerA, buyerB] = await Promise.all([seedBuyer("os-lh-a"), seedBuyer("os-lh-b")]);
    const liveBody = () => hostedBody(live.product, { discountCode: live.code, liveStreamId: live.streamId });

    const { winners, losers } = await race([
      () => call(app.base, "POST", "/api/buyer/checkout/session", buyerA, liveBody()),
      () => call(app.base, "POST", "/api/buyer/checkout/session", buyerB, liveBody()),
    ]);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expectCleanSoldOut(losers[0], live.product.variantId);
    expect(fake.state.checkoutSessionCreates).toHaveLength(1);
    expect(await stockOf(live.product.variantId)).toBe(0);

    const order = await payHostedSession(winners[0].body.sessionId, PRICE - 500);
    expect(order.status).toBe("processing");
    expect(await stockOf(live.product.variantId)).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("LIVE buy on in-app checkout: one PaymentIntent, one SOLD_OUT, the paid intent never double-decrements", async () => {
    const live = await seedLiveDrop("os-live-app");
    const [buyerA, buyerB] = await Promise.all([seedBuyer("os-la-a"), seedBuyer("os-la-b")]);
    const body = () => ({
      groups: [{
        items: [{ variantId: live.product.variantId, productId: live.product.productId, quantity: 1 }],
        discountCode: live.code,
        liveStreamId: live.streamId,
      }],
      contactEmail: "buyer@test.local",
      contactPhone: "+1 503 555 0100",
      shippingAddress: shipTo,
      clientIdempotencyKey: uid("pay"),
    });

    const { winners, losers } = await race([
      () => call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyerA, body()),
      () => call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyerB, body()),
    ]);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expectCleanSoldOut(losers[0], live.product.variantId);
    expect(fake.state.paymentIntents.size).toBe(1);
    expect(await stockOf(live.product.variantId)).toBe(0);

    const intent = fake.state.paymentIntents.get(winners[0].body.paymentIntentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${intent.id}`;
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());

    const [group] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intent.id));
    const made = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, group.stripeSessionId!));
    expect(made).toHaveLength(1);
    expect(made[0].status).toBe("processing");
    expect(await stockOf(live.product.variantId)).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("guest checkout: exactly one guest gets a Stripe session, the other SOLD_OUT", async () => {
    const seller = await seedSeller("os-guest");
    const product = await seedProduct(seller, { priceCents: PRICE, stock: 1 });
    const guestBody = (email: string) => {
      const { shippingAddress, ...rest } = hostedBody(product, { contactEmail: email });
      return {
        ...rest,
        shippingAddress: { name: shippingAddress.recipientName, street: shippingAddress.street, city: shippingAddress.city,
          state: shippingAddress.state, zip: shippingAddress.postalCode, country: "US", phone: shippingAddress.phone },
      };
    };

    const { results, winners, losers } = await race([
      () => call(app.base, "POST", "/api/guest/checkout/session", "", guestBody("guest-a@test.local")),
      () => call(app.base, "POST", "/api/guest/checkout/session", "", guestBody("guest-b@test.local")),
    ]);

    expect(winners, JSON.stringify(results)).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expectCleanSoldOut(losers[0], product.variantId);
    expect(fake.state.checkoutSessionCreates).toHaveLength(1);
    expect(await stockOf(product.variantId)).toBe(0);
  });

  it("a buyer who arrives after the unit is claimed is told it's sold out without touching Stripe", async () => {
    const seller = await seedSeller("os-late");
    const [buyerA, buyerB] = await Promise.all([seedBuyer("os-late-a"), seedBuyer("os-late-b")]);
    const product = await seedProduct(seller, { priceCents: PRICE, stock: 1 });
    expect((await call(app.base, "POST", "/api/buyer/checkout/session", buyerA, hostedBody(product))).status).toBe(200);

    const late = await call(app.base, "POST", "/api/buyer/checkout/session", buyerB, hostedBody(product));
    expect(late.status).toBe(409);
    expectCleanSoldOut(late, product.variantId);
    expect(fake.state.checkoutSessionCreates).toHaveLength(1);
  });
});

describe("oversell protection: holds that don't turn into orders go back on sale", () => {
  it("checkout.session.expired releases the hold", async () => {
    const seller = await seedSeller("os-expired");
    const buyer = await seedBuyer("os-expired");
    const product = await seedProduct(seller, { priceCents: PRICE, stock: 1 });
    const res = await call(app.base, "POST", "/api/buyer/checkout/session", buyer, hostedBody(product));
    expect(await stockOf(product.variantId)).toBe(0);

    const session = fake.state.checkoutSessions.get(res.body.sessionId);
    session.status = "expired";
    const signed = fake.signedEvent({
      id: `evt_${uid("exp").replace(/-/g, "_")}`, object: "event", type: "checkout.session.expired",
      livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session },
    });
    const delivered = await fetch(`${app.base}/api/webhooks/stripe`, {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": signed.header }, body: signed.payload,
    });
    expect(delivered.status).toBe(200);

    expect(await stockOf(product.variantId)).toBe(1);
    expect(await holdsFor(product.variantId)).toEqual([{ status: "released", quantity: 1 }]);
  });

  it("the sweep closes an abandoned hosted session and releases its hold, but keeps a completed one", async () => {
    const seller = await seedSeller("os-sweep");
    const [buyerA, buyerB] = await Promise.all([seedBuyer("os-sweep-a"), seedBuyer("os-sweep-b")]);
    const abandoned = await seedProduct(seller, { priceCents: PRICE, stock: 1 });
    const paying = await seedProduct(seller, { priceCents: PRICE, stock: 1 });
    const left = await call(app.base, "POST", "/api/buyer/checkout/session", buyerA, hostedBody(abandoned));
    const inFlight = await call(app.base, "POST", "/api/buyer/checkout/session", buyerB, hostedBody(paying));
    // A delayed payment method: the session is complete, the money hasn't landed yet.
    fake.state.checkoutSessions.get(inFlight.body.sessionId).status = "complete";

    await expireStockReservations({ now: new Date(Date.now() + HOSTED_STOCK_RESERVATION_TTL_MS + 60_000) });

    expect(fake.state.checkoutSessions.get(left.body.sessionId).status).toBe("expired");
    expect(await stockOf(abandoned.variantId)).toBe(1);
    expect(await stockOf(paying.variantId)).toBe(0);
    expect(await holdsFor(paying.variantId)).toEqual([{ status: "held", quantity: 1 }]);
  });
});
