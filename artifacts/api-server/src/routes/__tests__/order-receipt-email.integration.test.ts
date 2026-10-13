import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, checkoutSessions, notificationsFeed, orders, productVariants, products, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Item 104: the paid-order webhook sends the seller-branded receipt from the
// order rows, and every send for one order carries the same idempotency key
// and payload, so Resend delivers it once.

const state = vi.hoisted(() => ({ event: null as any }));
const sendOrderConfirmationEmail = vi.hoisted(() => vi.fn(async (_options: Record<string, unknown>) => true));

vi.mock("../../lib/stripe", () => ({
  STRIPE_WEBHOOK_SECRET: "test-secret",
  stripe: { webhooks: { constructEvent: vi.fn(() => state.event) } },
}));
vi.mock("../../lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/push")>()),
  sendPushToUser: vi.fn(async () => {}),
}));
vi.mock("../../lib/brandthreadEmail", () => ({
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail,
}));
vi.mock("../loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(),
  consumeLoyaltyRedemption: vi.fn(),
  releaseLoyaltyRedemption: vi.fn(),
}));

import webhookRouter from "../webhooks";

const suffix = crypto.randomUUID();
const sellerId = `receipt-seller-${suffix}`;
const buyerId = `receipt-buyer-${suffix}`;
const sessionId = `cs_receipt_${suffix}`;
const eventIds = [`evt_receipt_a_${suffix}`, `evt_receipt_b_${suffix}`];
let checkoutId = "";
let productId = "";
let variantId = "";
let server: Server;
let base = "";

function eventFor(id: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: 1_756_600_000,
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: `pi_receipt_${suffix}`,
        amount_total: 5_800,
        total_details: { amount_discount: 0, amount_shipping: 500, amount_tax: 300 },
        shipping_details: {
          name: "Alex Rivera",
          address: { line1: "12 Mercer St", line2: null, city: "New York", state: "NY", postal_code: "10013", country: "US" },
        },
        metadata: { csRef: checkoutId },
      },
    },
  };
}

const postEvent = (id: string) => {
  state.event = eventFor(id);
  return fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "test-signature" },
    body: JSON.stringify({ id }),
  });
};

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerId,
      email: `${sellerId}@test.local`,
      name: "Receipt Seller Person",
      brandName: "Northbound Studio",
      logoUrl: "https://cdn.example.com/northbound-logo.png",
      contactEmail: "hello@northbound.example",
      role: "seller",
      accountType: "seller",
    },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Receipt Buyer", role: "buyer", accountType: "buyer" },
  ]);
  const [product] = await db.insert(products).values({
    ownerId: sellerId,
    name: "Chrome Logo Tee",
    category: "apparel",
    status: "active",
    images: ["/objects/uploads/private.png", "https://cdn.example.com/tee.jpg"],
  }).returning({ id: products.id });
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId,
    sku: `receipt-${suffix}`,
    priceCents: 2_500,
    stock: 5,
  }).returning({ id: productVariants.id });
  variantId = variant.id;
  const [checkout] = await db.insert(checkoutSessions).values({
    stripeSessionId: sessionId,
    buyerId,
    sellerId,
    items: [{ variantId, productName: "Chrome Logo Tee", variantLabel: "M / Black", quantity: 2, priceCents: 2_500 }],
  }).returning({ id: checkoutSessions.id });
  checkoutId = checkout.id;

  const app = express();
  app.use(express.raw({ type: "application/json" }));
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api/webhooks", webhookRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of eventIds) await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id = ${id}`);
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, buyerId));
  await db.delete(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
  await db.delete(checkoutSessions).where(eq(checkoutSessions.id, checkoutId));
  await db.delete(productVariants).where(eq(productVariants.id, variantId));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(eq(users.clerkId, buyerId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
});

describe("order receipt email from the paid-order webhook", () => {
  it("sends the branded receipt from the order rows, once per order", async () => {
    expect((await postEvent(eventIds[0])).status).toBe(200);
    const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
    expect(order).toBeDefined();
    expect(sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);

    const sent = sendOrderConfirmationEmail.mock.calls[0][0] as any;
    expect(sent).toMatchObject({
      to: `${buyerId}@test.local`,
      orderNumber: order.orderNumber,
      subtotalCents: order.subtotalCents,
      shippingCents: 500,
      taxCents: 300,
      totalCents: order.totalCents,
      discountCents: 0,
      threadCashCents: 0,
      giftCardCents: 0,
      idempotencyKey: `order-confirmation/${order.id}`,
      store: {
        name: "Northbound Studio",
        logoUrl: "https://cdn.example.com/northbound-logo.png",
        contactEmail: "hello@northbound.example",
      },
      shippingAddress: { name: "Alex Rivera", street: "12 Mercer St", city: "New York", state: "NY", zip: "10013" },
    });
    expect(order.totalCents).toBe(5_800);
    expect(sent.items).toEqual([
      expect.objectContaining({
        productName: "Chrome Logo Tee",
        quantity: 2,
        priceCents: 2_500,
        imageUrl: "https://cdn.example.com/tee.jpg",
      }),
    ]);

    // Stripe redelivers the same event: deduped before any email.
    const dup = await postEvent(eventIds[0]);
    expect(await dup.json()).toMatchObject({ duplicate: true });
    expect(sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);

    // A different event for the same paid session re-runs the existing-order
    // path; the receipt is re-attempted with the same key and identical
    // payload, which Resend's Idempotency-Key collapses into one delivery.
    expect((await postEvent(eventIds[1])).status).toBe(200);
    const keys = sendOrderConfirmationEmail.mock.calls.map(([options]) => (options as any).idempotencyKey);
    expect(new Set(keys)).toEqual(new Set([`order-confirmation/${order.id}`]));
    for (const [options] of sendOrderConfirmationEmail.mock.calls) expect(options).toEqual(sent);
    expect(await db.select({ id: orders.id }).from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId))).toHaveLength(1);
  });
});
