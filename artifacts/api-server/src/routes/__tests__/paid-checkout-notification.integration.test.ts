import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db,
  checkoutSessions,
  notificationsFeed,
  orders,
  productVariants,
  products,
  users,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const state = vi.hoisted(() => ({
  event: null as any,
  pushCalls: 0,
}));

vi.mock("../../lib/stripe", () => ({
  STRIPE_WEBHOOK_SECRET: "test-secret",
  stripe: {
    webhooks: {
      constructEvent: vi.fn(() => state.event),
    },
  },
}));

vi.mock("../../lib/push", () => ({
  normalizePushEventCategory: vi.fn(() => "orders"),
  sendPushToUser: vi.fn(async () => {
    state.pushCalls += 1;
  }),
}));

vi.mock("../../lib/brandthreadEmail", () => ({
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail: vi.fn(async () => {}),
}));

vi.mock("../loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(),
  consumeLoyaltyRedemption: vi.fn(),
  releaseLoyaltyRedemption: vi.fn(),
}));

import webhookRouter from "../webhooks";

const suffix = crypto.randomUUID();
const sellerId = `paid-checkout-notification-seller-${suffix}`;
const buyerId = `paid-checkout-notification-buyer-${suffix}`;
const sessionId = `cs_paid_checkout_notification_${suffix}`;
const eventId = `evt_paid_checkout_notification_${suffix}`;
let checkoutId = "";
let productId = "";
let variantId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerId,
      email: `${sellerId}@test.local`,
      name: "Paid Checkout Notification Seller",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: buyerId,
      email: `${buyerId}@test.local`,
      name: "Paid Checkout Notification Buyer",
      role: "buyer",
      accountType: "buyer",
    },
  ]);

  const [product] = await db.insert(products).values({
    ownerId: sellerId,
    name: "Paid checkout notification product",
    category: "apparel",
    status: "active",
  }).returning({ id: products.id });
  productId = product.id;

  const [variant] = await db.insert(productVariants).values({
    productId,
    sku: `paid-checkout-notification-${suffix}`,
    priceCents: 2_500,
    stock: 5,
  }).returning({ id: productVariants.id });
  variantId = variant.id;

  const [checkout] = await db.insert(checkoutSessions).values({
    stripeSessionId: sessionId,
    buyerId,
    sellerId,
    items: [{
      variantId,
      productName: "Paid checkout notification product",
      variantLabel: "Default",
      quantity: 1,
      priceCents: 2_500,
    }],
  }).returning({ id: checkoutSessions.id });
  checkoutId = checkout.id;

  state.event = {
    id: eventId,
    type: "checkout.session.completed",
    created: 1_756_600_000,
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: `pi_paid_checkout_notification_${suffix}`,
        amount_total: 2_500,
        total_details: {
          amount_discount: 0,
          amount_shipping: 0,
          amount_tax: 0,
        },
        metadata: { csRef: checkoutId },
      },
    },
  };

  const app = express();
  app.use(express.raw({ type: "application/json" }));
  app.use((req, _res, next) => {
    (req as any).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use("/api/webhooks", webhookRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id = ${eventId}`);
  await db.delete(notificationsFeed).where(
    and(
      eq(notificationsFeed.userId, sellerId),
      eq(notificationsFeed.targetType, "order"),
    ),
  );
  await db.delete(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
  await db.delete(checkoutSessions).where(eq(checkoutSessions.id, checkoutId));
  await db.delete(productVariants).where(eq(productVariants.id, variantId));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(eq(users.clerkId, buyerId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
});

describe("paid checkout webhook seller notification", () => {
  it("persists one order and one deep-linkable alert when Stripe retries the same event", async () => {
    const postEvent = () => fetch(`${base}/api/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "test-signature",
      },
      body: JSON.stringify({ retry: true }),
    });

    const first = await postEvent();
    const second = await postEvent();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true });
    expect(await second.json()).toMatchObject({ received: true, duplicate: true });

    const persistedOrders = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.stripeCheckoutSessionId, sessionId));
    expect(persistedOrders).toHaveLength(1);

    const notifications = await db
      .select({
        targetId: notificationsFeed.targetId,
        targetType: notificationsFeed.targetType,
      })
      .from(notificationsFeed)
      .where(and(
        eq(notificationsFeed.userId, sellerId),
        eq(notificationsFeed.type, "new_order_received"),
      ));
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      targetId: persistedOrders[0].id,
      targetType: "order",
    });
    expect(state.pushCalls).toBe(1);
  });
});