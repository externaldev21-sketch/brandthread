/**
 * Checkout + inventory, both sides, through the whole app (see
 * testUtils/commerceApp.ts and docs/flows/commerce.md flows 1–2).
 *
 * Each case is a break that running the flow end to end found:
 *  - in-app PaymentSheet / Apple Pay carts become orders from
 *    payment_intent.succeeded (and the endpoint now subscribes to it)
 *  - a seller stock edit no longer overwrites concurrent changes
 *  - cancelling an unpaid seller-created order puts its stock back
 *  - concurrent orders never share an order number
 *  - paid-order low/out-of-stock alerts push, and re-arm after a restock
 *  - cart validation flags a changed price (the app sends priceCents)
 *  - the seller hears when an oversold order is auto-refunded
 *  - a cancellation that restocks tells savers it's back in stock
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

vi.hoisted(() => {
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

import { db, notificationsFeed, orders, productVariants, savedItems } from "@workspace/db";
import { startCommerceApp, TEST_ADDRESS, type CommerceApp } from "../../testUtils/commerceApp";

let app: CommerceApp;

const stockOf = async (variantId: string) =>
  (await db.select({ stock: productVariants.stock }).from(productVariants).where(eq(productVariants.id, variantId)))[0].stock;
const feedFor = (userId: string) => db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, userId));
const pushesTo = (userId: string) => fake.pushes.filter((p) => p.userId === userId);

beforeAll(async () => {
  app = await startCommerceApp("chkinv", fake);
});
afterAll(async () => {
  await app?.stop();
});

describe("in-app PaymentSheet / Apple Pay checkout", () => {
  it("holds stock, then payment_intent.succeeded creates the order both sides see", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({
      name: "Sheet Hoodie", variants: [{ size: "M", priceCents: 6_000, stock: 5 }],
    });
    const created = await app.asBuyer("POST", "/api/buyer/checkout/payment-intent", {
      groups: [{ items: [{ productId, variantId, quantity: 2 }] }],
      contactEmail: `${app.buyer}@test.local`,
      contactPhone: "+1 503 555 0100",
      shippingAddress: TEST_ADDRESS,
      clientIdempotencyKey: `sheet-${crypto.randomUUID()}`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    // Units are held while the buyer is in the payment sheet.
    expect(await stockOf(variantId)).toBe(3);

    const pi = fake.stripe.objects.get(created.body.paymentIntentId);
    const paid = await app.stripeEvent("payment_intent.succeeded", {
      ...pi, status: "succeeded", amount_received: created.body.amountCents,
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);

    const sellerOrders = await app.asSeller("GET", "/api/orders");
    const buyerOrders = await app.asBuyer("GET", "/api/buyer/orders");
    const sellerView = sellerOrders.body.find((o: any) => o.stripePaymentIntentId === pi.id || o.paidAt);
    expect(sellerView).toBeTruthy();
    expect(buyerOrders.body.map((o: any) => o.id)).toContain(sellerView.id);
    // The hold became the sale: no second decrement.
    expect(await stockOf(variantId)).toBe(3);
    expect((await feedFor(app.seller)).map((n) => n.type)).toContain("new_order_received");
  });
});

describe("seller inventory edits", () => {
  it("concurrent stock adjustments all apply (no lost update)", async () => {
    const { variantIds: [variantId] } = await app.listProduct({
      name: "Adjust Tee", variants: [{ priceCents: 2_000, stock: 20 }],
    });
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      app.asSeller("PATCH", `/api/inventory/${variantId}/adjust`, { delta: -1 })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await stockOf(variantId)).toBe(10);
  });

  it("a stock edit made while a sale lands keeps the sale", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({
      name: "Race Tee", variants: [{ priceCents: 2_000, stock: 10 }],
    });
    await Promise.all([
      app.buyViaHostedCheckout([{ productId, variantId, quantity: 3 }]),
      app.asSeller("PATCH", `/api/inventory/${variantId}/adjust`, { delta: 5 }),
    ]);
    expect(await stockOf(variantId)).toBe(12);
  });

  it("rejects a non-integer delta", async () => {
    const { variantIds: [variantId] } = await app.listProduct({ name: "Bad Delta", variants: [{ priceCents: 1_000, stock: 1 }] });
    const res = await app.asSeller("PATCH", `/api/inventory/${variantId}/adjust`, { delta: 1.5 });
    expect(res.status).toBe(400);
  });
});

describe("seller-created orders", () => {
  it("cancelling an unpaid manual order restores its stock", async () => {
    const { variantIds: [variantId] } = await app.listProduct({ name: "Manual Tee", variants: [{ priceCents: 3_000, stock: 4 }] });
    const created = await app.asSeller("POST", "/api/orders", {
      items: [{ variantId, productName: "Manual Tee", quantity: 3 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await stockOf(variantId)).toBe(1);

    const cancelled = await app.asSeller("PATCH", `/api/orders/${created.body.id}/status`, { status: "cancelled", reason: "customer_request" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await stockOf(variantId)).toBe(4);

    // Idempotent: a repeat cancel doesn't add stock twice.
    await app.asSeller("PATCH", `/api/orders/${created.body.id}/status`, { status: "cancelled", reason: "customer_request" });
    expect(await stockOf(variantId)).toBe(4);
  });

  it("concurrent orders get distinct order numbers", async () => {
    const { variantIds: [variantId] } = await app.listProduct({ name: "Number Tee", variants: [{ priceCents: 1_000, stock: 50 }] });
    const created = await Promise.all(Array.from({ length: 8 }, () =>
      app.asSeller("POST", "/api/orders", { items: [{ variantId, productName: "Number Tee", quantity: 1 }] })));
    expect(created.every((r) => r.status === 201)).toBe(true);
    const numbers = created.map((r) => r.body.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^BT-\d{5}$/);
  });
});

describe("stock alerts across both sides", () => {
  it("a paid order that sells a variant out pushes the seller, and a restock re-arms the alert", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({
      name: "Alert Tee", variants: [{ priceCents: 2_500, stock: 2, lowStockThreshold: 1 }],
    });
    const pushesBefore = pushesTo(app.seller).length;
    await app.buyViaHostedCheckout([{ productId, variantId, quantity: 2 }]);

    const alerts = (await feedFor(app.seller)).filter((n) => n.type === "low_stock" && n.targetId === productId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("Out of stock");
    expect(pushesTo(app.seller).some((p) => p.payload?.title === "Out of stock")).toBe(true);
    expect(pushesTo(app.seller).length).toBeGreaterThan(pushesBefore);

    // Restock, then sell out again: the seller is alerted a second time.
    await app.asSeller("PATCH", `/api/inventory/${variantId}/adjust`, { delta: 1 });
    expect((await feedFor(app.seller)).filter((n) => n.type === "low_stock" && n.targetId === productId)).toHaveLength(0);
    await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    expect((await feedFor(app.seller)).filter((n) => n.type === "low_stock" && n.targetId === productId)).toHaveLength(1);
  });

  it("a buyer cancellation that restocks tells savers it's back in stock", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({
      name: "Saved Tee", variants: [{ priceCents: 2_500, stock: 1 }],
    });
    const saver = await app.addUser("buyer");
    await db.insert(savedItems).values({ userId: saver, itemType: "product", targetId: productId, title: "Saved Tee" });

    const orderId = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    expect(await stockOf(variantId)).toBe(0);
    const cancel = await app.asBuyer("POST", `/api/buyer/orders/${orderId}/cancel`, {});
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(await stockOf(variantId)).toBe(1);

    const saverFeed = await feedFor(saver);
    expect(saverFeed.map((n) => n.type)).toContain("back_in_stock");
    const [saved] = await db.select().from(savedItems)
      .where(and(eq(savedItems.userId, saver), eq(savedItems.targetId, productId)));
    expect(saved.backInStockAt).toBeTruthy();
  });
});

describe("cart validation", () => {
  it("flags a price the seller changed since the buyer added it (priceCents from the app)", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Price Tee", variants: [{ priceCents: 3_000, stock: 5 }] });
    const ok = await app.asBuyer("POST", "/api/buyer/cart/validate", {
      items: [{ id: "r1", productId, variantId, quantity: 1, priceCents: 3_000 }],
    });
    expect(ok.body).toMatchObject({ isValid: true });
    await db.update(productVariants).set({ priceCents: 3_500 }).where(eq(productVariants.id, variantId));
    const changed = await app.asBuyer("POST", "/api/buyer/cart/validate", {
      items: [{ id: "r1", productId, variantId, quantity: 1, priceCents: 3_000 }],
    });
    expect(changed.body.isValid).toBe(false);
    expect(changed.body.issues[0]).toMatchObject({ type: "price_changed", oldValue: 30, newValue: 35 });
  });
});

describe("oversold orders", () => {
  it("auto-refunds the buyer and tells the seller why the order was cancelled", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Oversold Tee", variants: [{ priceCents: 4_000, stock: 2 }] });
    // Session created while 2 are in stock; the seller then sells them elsewhere.
    const session = await app.asBuyer("POST", "/api/buyer/checkout/session", {
      items: [{ productId, variantId, quantity: 2 }],
      successUrl: "https://app.test/s", cancelUrl: "https://app.test/c",
      contactEmail: `${app.buyer}@test.local`, contactPhone: "+1 503 555 0100",
      shippingAddress: TEST_ADDRESS, clientIdempotencyKey: `over-${crypto.randomUUID()}`,
    });
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    const csRef = fake.stripe.callsTo("checkout.sessions.create").at(-1).args[0].metadata.csRef;
    await app.asSeller("PATCH", `/api/inventory/${variantId}/adjust`, { delta: -1 });

    const paid = await app.stripeEvent("checkout.session.completed", {
      id: session.body.sessionId, payment_status: "paid", payment_intent: `pi_over_${crypto.randomUUID()}`,
      amount_total: 8_000, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      metadata: { csRef },
    });
    expect(paid.status).toBe(200);
    const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, session.body.sessionId));
    expect(order.status).toBe("cancelled");
    expect(await stockOf(variantId)).toBe(1); // untouched by the failed sale

    const sellerAlert = (await feedFor(app.seller)).find((n) => n.type === "order_cancelled_sold_out" && n.targetId === order.id);
    expect(sellerAlert?.body).toContain("Oversold Tee");
    expect((await feedFor(app.buyer)).some((n) => n.type === "order_cancelled" && n.targetId === order.id)).toBe(true);
  });
});
