/**
 * Money + chargebacks, both sides, through the whole app in production
 * payout timing (PAYOUT_MODE=hold). See docs/flows/commerce.md flows 3–5.
 *
 * Breaks this pins:
 *  - the seller hears when an order is delivered (payout clock starts) and
 *    when its payout transfer is sent
 *  - Thread Cash the buyer spent is paid to the seller with the order's
 *    payout in hold mode (it was only topped up for destination charges)
 *  - a chargeback reaches every seller its payment covered, pauses each of
 *    their orders, and the dispute carries amountCents
 *  - evidence sends a real tracking number; Accept closes it on Stripe
 *  - the seller hears the outcome
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";

vi.hoisted(() => {
  process.env.PAYOUT_MODE = "hold";
  process.env.STRIPE_SECRET_KEY = "sk_test_commerce_e2e";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_commerce_e2e";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||= "http://127.0.0.1:9/openai";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||= "test-not-used";
});
const fake = vi.hoisted(() => ({ stripe: null as any, pushes: [] as Array<{ userId: string; payload: any }> }));

vi.mock("stripe", async () => {
  const { createFakeStripe } = await import("../../testUtils/fakeStripe");
  fake.stripe = createFakeStripe();
  return { default: class { constructor() { return fake.stripe.client; } } };
});
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: any) => ({ userId: req.headers["x-test-user-id"] ?? null }),
  clerkClient: { users: { getUser: async () => null } },
}));
vi.mock("@clerk/shared/keys", () => ({ publishableKeyFromHost: () => "pk_test_commerce" }));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: vi.fn(async (userId: string, payload: any) => { fake.pushes.push({ userId, payload }); }),
  };
});

import { db, disputes, notificationsFeed, orders } from "@workspace/db";
import { startCommerceApp, TEST_ADDRESS, type CommerceApp } from "../../testUtils/commerceApp";
import { settleTransferOrder } from "../../lib/money/cartTransfers";

let app: CommerceApp;
const feedFor = (userId: string) => db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, userId));
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0];

beforeAll(async () => {
  app = await startCommerceApp("money", fake);
});
afterAll(async () => {
  if (app) {
    const ids = [app.seller];
    await db.delete(disputes).where(inArray(disputes.sellerId, ids)).catch(() => {});
    await app.stop();
  }
});

/** One in-app PaymentIntent paying a cart from two sellers. */
async function payTwoSellerCart(otherSeller: string) {
  const a = await app.listProduct({ name: "Shared Cart Tee", variants: [{ priceCents: 3_000, stock: 5 }] });
  const b = await app.listProduct({ name: "Other Seller Cap", variants: [{ priceCents: 2_000, stock: 5 }], as: otherSeller });
  const created = await app.asBuyer("POST", "/api/buyer/checkout/payment-intent", {
    groups: [
      { items: [{ productId: a.productId, variantId: a.variantIds[0], quantity: 1 }] },
      { items: [{ productId: b.productId, variantId: b.variantIds[0], quantity: 1 }] },
    ],
    contactEmail: `${app.buyer}@test.local`,
    contactPhone: "+1 503 555 0100",
    shippingAddress: TEST_ADDRESS,
    clientIdempotencyKey: `cart-${crypto.randomUUID()}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const pi = fake.stripe.objects.get(created.body.paymentIntentId);
  const paid = await app.stripeEvent("payment_intent.succeeded", { ...pi, status: "succeeded", amount_received: created.body.amountCents });
  expect(paid.status).toBe(200);
  const rows = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, pi.id));
  expect(rows).toHaveLength(2);
  return { pi, mine: rows.find((o) => o.ownerId === app.seller)!, theirs: rows.find((o) => o.ownerId === otherSeller)! };
}

describe("delivery → payout reaches the seller", () => {
  it("tells the seller when the buyer confirms delivery and when the payout transfer is sent", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Payout Tee", variants: [{ priceCents: 5_000, stock: 3 }] });
    const orderId = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    const paid = await orderRow(orderId);
    expect(paid.chargeModel).toBe("transfer"); // hold-until-delivered
    expect(paid.fundsState).toBe("held");

    const shipped = await app.asSeller("PATCH", `/api/orders/${orderId}/tracking`, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    const confirm = await app.asBuyer("POST", `/api/buyer/orders/${orderId}/confirm-receipt`, {});
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    const delivered = (await feedFor(app.seller)).find((n) => n.type === "order_delivered_seller" && n.targetId === orderId);
    expect(delivered?.body).toContain("The buyer confirmed they received it.");
    expect(delivered?.body).toContain("payout for it releases");

    // Not before the buffer…
    expect(await settleTransferOrder(orderId)).toBe("not_ready");
    // …then the sweep pays the seller and tells them.
    const after = (await orderRow(orderId)).payoutReleaseAt!;
    expect(await settleTransferOrder(orderId, { now: new Date(after.valueOf() + 1_000) })).toBe("transferred");
    const transfer = fake.stripe.callsTo("transfers.create").find((c: any) => c.args[0]?.metadata?.orderId === orderId);
    expect(transfer).toBeTruthy();
    const sent = (await feedFor(app.seller)).find((n) => n.type === "payout_transfer_sent" && n.targetId === orderId);
    expect(sent?.title).toContain(`$${(transfer.args[0].amount / 100).toFixed(2)}`);
  });

  it("pays the seller the Thread Cash part of a hold-mode order with its payout", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Thread Cash Tee", variants: [{ priceCents: 4_000, stock: 3 }] });
    const orderId = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    // The buyer covered $5 of it with platform-funded Thread Cash.
    await db.update(orders).set({ threadCashAppliedCents: 500 }).where(eq(orders.id, orderId));
    await app.asSeller("PATCH", `/api/orders/${orderId}/tracking`, { trackingNumber: "1Z999AA10123456785", carrier: "UPS" });
    await app.asBuyer("POST", `/api/buyer/orders/${orderId}/confirm-receipt`, {});
    const releaseAt = (await orderRow(orderId)).payoutReleaseAt!;
    expect(await settleTransferOrder(orderId, { now: new Date(releaseAt.valueOf() + 1_000) })).toBe("transferred");

    const topup = fake.stripe.callsTo("transfers.create")
      .find((c: any) => c.args[0]?.metadata?.kind === "thread_cash_seller_topup" && c.args[0]?.metadata?.orderId === orderId);
    expect(topup?.args[0].amount).toBe(500);
    expect((await orderRow(orderId)).stripeThreadCashTransferId).toBeTruthy();
  });
});

describe("chargebacks reach every seller the payment covered", () => {
  it("records the dispute on the matching order, pauses both orders, and alerts both sellers", async () => {
    const other = await app.addSeller();
    const { pi, mine, theirs } = await payTwoSellerCart(other);

    const opened = await app.stripeEvent("charge.dispute.created", {
      id: `dp_${crypto.randomUUID()}`,
      object: "dispute",
      payment_intent: pi.id,
      charge: `ch_${crypto.randomUUID()}`,
      amount: mine.grossChargedCents,
      currency: "usd",
      reason: "product_not_received",
      status: "needs_response",
      evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86_400 },
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);

    // Both sellers' payouts are paused…
    expect((await orderRow(mine.id)).disputePausedAt).toBeTruthy();
    expect((await orderRow(theirs.id)).disputePausedAt).toBeTruthy();
    // …the dispute is the seller whose order matches the disputed amount…
    const list = await app.asSeller("GET", "/api/disputes");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ orderId: mine.id, amountCents: mine.grossChargedCents });
    const disputeId = list.body[0].id;
    // …and both sellers are told; the owner's alert opens the dispute.
    const mineAlert = (await feedFor(app.seller)).find((n) => n.type === "dispute_opened");
    expect(mineAlert).toMatchObject({ targetType: "dispute", targetId: disputeId, category: "disputes" });
    const theirAlert = (await feedFor(other)).find((n) => n.type === "dispute_opened");
    expect(theirAlert).toMatchObject({ targetType: "order", targetId: theirs.id });
    expect(fake.pushes.some((p) => p.userId === other && p.payload?.title?.startsWith("Chargeback"))).toBe(true);

    // A retried event doesn't alert again.
    const before = (await feedFor(app.seller)).length;
    await app.stripeEvent("charge.dispute.created", {
      id: list.body[0].stripeDisputeId, object: "dispute", payment_intent: pi.id, amount: mine.grossChargedCents,
      currency: "usd", reason: "product_not_received", status: "needs_response",
    });
    expect((await feedFor(app.seller)).length).toBe(before);

    // Evidence carries the real tracking number to Stripe.
    const evidence = await app.asSeller("POST", `/api/disputes/${disputeId}/evidence`, {
      type: "tracking", description: "Delivered to the front porch", trackingNumber: "1Z999AA10123456786",
    });
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(200);
    const update = fake.stripe.callsTo("disputes.update").at(-1);
    expect(update.args[1].evidence.shipping_tracking_number).toBe("1Z999AA10123456786");
    expect(update.args[1].evidence.shipping_documentation).toBe("Delivered to the front porch");

    // Won: payouts resume and the seller hears it.
    const won = await app.stripeEvent("charge.dispute.closed", {
      id: list.body[0].stripeDisputeId, object: "dispute", status: "won", amount: mine.grossChargedCents,
    });
    expect(won.status).toBe(200);
    expect((await orderRow(mine.id)).disputePausedAt).toBeNull();
    expect((await orderRow(theirs.id)).disputePausedAt).toBeNull();
    const outcome = (await feedFor(app.seller)).find((n) => n.type === "dispute_closed");
    expect(outcome?.title).toContain("Chargeback won");
  });

  it("Accept concedes the dispute on Stripe instead of only flipping a local row", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Accept Tee", variants: [{ priceCents: 2_500, stock: 3 }] });
    const orderId = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    const order = await orderRow(orderId);
    const stripeDisputeId = `dp_${crypto.randomUUID()}`;
    await app.stripeEvent("charge.dispute.created", {
      id: stripeDisputeId, object: "dispute", payment_intent: order.stripePaymentIntentId,
      amount: order.grossChargedCents, currency: "usd", reason: "fraudulent", status: "needs_response",
    });
    const [row] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, stripeDisputeId));
    const accepted = await app.asSeller("POST", `/api/disputes/${row.id}/accept`, {});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(fake.stripe.callsTo("disputes.close").map((c: any) => c.args[0])).toContain(stripeDisputeId);
    expect(accepted.body.dispute.status).toBe("lost");
  });
});
