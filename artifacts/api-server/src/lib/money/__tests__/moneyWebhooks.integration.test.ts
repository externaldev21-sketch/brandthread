/**
 * Stripe webhooks for money, over real HTTP with real signature
 * verification (Stripe SDK) and a real Postgres event ledger:
 * duplicates, replays of old signatures, forged signatures, wrong-mode
 * events, Stripe outages mid-webhook, and refunds made outside Brandthread.
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
}));

import crypto from "node:crypto";
import Stripe from "stripe";
import { db, checkoutSessions, orderRefunds, orders } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake, TEST_WEBHOOK_SECRET } from "./fakeStripe";
import {
  expectLedgerBalanced, orderLedger, pay, reloadOrder, seedBuyer, seedProduct, seedSeller, startApp, uid,
} from "./moneyHarness";
import { destinationApplicationFeeCents } from "../fees";
import { refundOrder } from "../refunds";
import webhooksRouter from "../../../routes/webhooks";

let app: { base: string; close: () => Promise<void> };
const originalKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  app = await startApp((server) => server.use("/api/webhooks", webhooksRouter));
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await expectLedgerBalanced();
  await app?.close();
});
beforeEach(() => fake.reset());

async function deliver(payload: string, header: string) {
  const response = await fetch(`${app.base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function event(type: string, object: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${uid("wh").replace(/-/g, "_")}`,
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object },
    ...overrides,
  };
}

async function openCheckout() {
  const seller = await seedSeller("wh");
  const buyer = await seedBuyer("wh");
  const product = await seedProduct(seller, { priceCents: 4_200 });
  const fee = destinationApplicationFeeCents({ merchandiseCents: 4_200, preTaxTotalCents: 4_200 });
  const sessionId = `cs_${uid("whs").replace(/-/g, "_")}`;
  const [checkout] = await db.insert(checkoutSessions).values({
    buyerId: buyer,
    sellerId: seller,
    stripeSessionId: sessionId,
    items: [{ variantId: product.variantId, productName: product.productName, variantLabel: "M", quantity: 1, priceCents: 4_200 }],
    chargeModel: "destination",
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  }).returning();
  const session = {
    id: sessionId,
    object: "checkout.session",
    payment_intent: `pi_${uid("whpi").replace(/-/g, "_")}`,
    payment_status: "paid",
    amount_total: 4_200,
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
    metadata: { csRef: checkout.id },
  };
  return { seller, buyer, session };
}

async function ordersForSession(sessionId: string) {
  return db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
}

describe("Stripe webhook signature and replay safety", () => {
  it("creates one order for a signed event, and ignores re-deliveries of it", async () => {
    const { session } = await openCheckout();
    const paid = event("checkout.session.completed", session);
    const signed = fake.signedEvent(paid);

    expect(await deliver(signed.payload, signed.header)).toMatchObject({ status: 200, body: { received: true } });
    expect(await deliver(signed.payload, signed.header)).toMatchObject({ status: 200, body: { duplicate: true } });

    // Stripe can also send a second, different event for the same payment.
    const again = fake.signedEvent(event("checkout.session.async_payment_succeeded", session));
    expect((await deliver(again.payload, again.header)).status).toBe(200);

    const created = await ordersForSession(session.id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ fundsState: "settled_direct", grossChargedCents: 4_200 });
    const ledger = await db.execute(sql`
      SELECT count(*)::int AS n FROM ledger_transactions WHERE idempotency_key = ${`order-paid/${created[0].id}`}
    `);
    expect((ledger.rows[0] as { n: number }).n).toBe(1);
  });

  it("rejects a forged signature before recording anything", async () => {
    const { session } = await openCheckout();
    const forged = event("checkout.session.completed", session);
    const signed = fake.signedEvent(forged, "whsec_attacker_secret");
    const response = await deliver(signed.payload, signed.header);
    expect(response.status).toBe(400);
    const recorded = await db.execute(sql`SELECT 1 FROM stripe_webhook_events WHERE event_id = ${forged.id}`);
    expect(recorded.rows).toHaveLength(0);
    expect(await ordersForSession(session.id)).toHaveLength(0);
  });

  it("rejects a tampered body even with a once-valid signature", async () => {
    const { session } = await openCheckout();
    const signed = fake.signedEvent(event("checkout.session.completed", session));
    const tampered = signed.payload.replace('"amount_total":4200', '"amount_total":1');
    expect((await deliver(tampered, signed.header)).status).toBe(400);
  });

  it("rejects a replay of a captured request after the signature tolerance", async () => {
    const { session } = await openCheckout();
    const old = event("checkout.session.completed", session);
    const payload = JSON.stringify(old);
    const header = new Stripe("sk_test_placeholder").webhooks.generateTestHeaderString({
      payload,
      secret: TEST_WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 15 * 60,
    });
    expect((await deliver(payload, header)).status).toBe(400);
    expect(await ordersForSession(session.id)).toHaveLength(0);
  });

  it("rejects a live-mode event on a test-mode server", async () => {
    const { session } = await openCheckout();
    const live = fake.signedEvent(event("checkout.session.completed", session, { livemode: true }));
    expect(await deliver(live.payload, live.header)).toMatchObject({ status: 400, body: { code: "LIVEMODE_MISMATCH" } });
    expect(await ordersForSession(session.id)).toHaveLength(0);
  });

  it("fails the delivery when Stripe is unreachable, and the retry creates the order once", async () => {
    const { session } = await openCheckout();
    const paid = event("checkout.session.completed", session);
    const signed = fake.signedEvent(paid);
    fake.state.retrieveFails = true;
    expect((await deliver(signed.payload, signed.header)).status).toBe(500);
    expect(await ordersForSession(session.id)).toHaveLength(0);

    fake.state.retrieveFails = false;
    const retry = fake.signedEvent(paid);
    expect((await deliver(retry.payload, retry.header)).status).toBe(200);
    expect(await ordersForSession(session.id)).toHaveLength(1);
  });
});

describe("refund webhooks", () => {
  it("records a refund made in the Stripe dashboard exactly once", async () => {
    const seller = await seedSeller("dash");
    const buyer = await seedBuyer("dash");
    const product = await seedProduct(seller, { priceCents: 5_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });

    const charge = { id: order.stripeChargeId, object: "charge", payment_intent: order.stripePaymentIntentId, amount_refunded: 1_500 };
    const first = fake.signedEvent(event("charge.refunded", charge));
    expect((await deliver(first.payload, first.header)).status).toBe(200);
    // A second event carrying the same cumulative total adds nothing.
    const second = fake.signedEvent(event("charge.refunded", charge));
    expect((await deliver(second.payload, second.header)).status).toBe(200);

    const after = await reloadOrder(order.id);
    expect(after.refundedCents).toBe(1_500);
    const refunds = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, order.id));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: "stripe_dashboard", amountCents: 1_500, state: "succeeded" });
    // It is flagged as money the seller owes, pending review.
    expect((await orderLedger(order.id)).platform_funds_advanced).toBe(-1_500);
  });

  it("does not double count Brandthread's own refunds when Stripe reports them", async () => {
    const seller = await seedSeller("own");
    const buyer = await seedBuyer("own");
    const product = await seedProduct(seller, { priceCents: 2_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    await refundOrder({ orderId: order.id, amountCents: 800, reason: "return_approved", initiatedBy: seller, idempotencyKey: `own/${order.id}` });

    const charge = { id: order.stripeChargeId, object: "charge", payment_intent: order.stripePaymentIntentId, amount_refunded: 800 };
    const signed = fake.signedEvent(event("charge.refunded", charge));
    expect((await deliver(signed.payload, signed.header)).status).toBe(200);
    expect((await reloadOrder(order.id)).refundedCents).toBe(800);
    expect(await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, order.id))).toHaveLength(1);
  });

  it("reverses the books when Stripe fails a refund after accepting it", async () => {
    const seller = await seedSeller("late-fail");
    const buyer = await seedBuyer("late-fail");
    const product = await seedProduct(seller, { priceCents: 3_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    const refund = await refundOrder({ orderId: order.id, reason: "seller_cancelled", initiatedBy: seller, idempotencyKey: `late/${order.id}` });
    expect((await reloadOrder(order.id)).fundsState).toBe("refunded");
    const before = await orderLedger(order.id);

    const failed = fake.signedEvent(event("charge.refund.updated", { id: refund.stripeRefundId, object: "refund", status: "failed" }));
    expect((await deliver(failed.payload, failed.header)).status).toBe(200);
    // Delivered twice: the reversal still happens once.
    const again = fake.signedEvent(event("charge.refund.updated", { id: refund.stripeRefundId, object: "refund", status: "failed" }));
    expect((await deliver(again.payload, again.header)).status).toBe(200);

    const after = await reloadOrder(order.id);
    expect(after).toMatchObject({ refundedCents: 0, platformFeeRefundedCents: 0, fundsState: "settled_direct" });
    const ledger = await orderLedger(order.id);
    expect(ledger.buyer_payments).toBe(-3_000);
    expect(before.buyer_payments).toBe(0);
    const [row] = await db.select().from(orderRefunds).where(eq(orderRefunds.id, refund.refundId));
    expect(row).toMatchObject({ state: "failed", failureCode: "failed_after_success" });
  });
});

void crypto;
