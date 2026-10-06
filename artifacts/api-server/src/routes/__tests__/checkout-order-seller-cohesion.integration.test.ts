/**
 * Buyer checkout → seller cohesion (item 99).
 *
 * One real paid-checkout webhook, then both sides read the SAME order row
 * through their real routes:
 *   - seller: GET /api/orders (Orders tab + dashboard "to ship" count)
 *   - buyer:  GET /api/buyer/orders
 *   - seller: notifications_feed "new_order_received" deep link
 * Same order id, same BT-00000 number, same status enum — no forked model.
 * Also pins that the seller list carries `paidAt` (a paid checkout order is
 * stored as status "pending", so without it the app showed it as unpaid).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db,
  checkoutSessions,
  notificationsFeed,
  orderItems,
  orders,
  productVariants,
  products,
  users,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

const state = vi.hoisted(() => ({ event: null as any }));

vi.mock("../../lib/stripe", () => ({
  STRIPE_WEBHOOK_SECRET: "test-secret",
  stripe: { webhooks: { constructEvent: vi.fn(() => state.event) } },
}));
vi.mock("../../lib/push", () => ({
  normalizePushEventCategory: vi.fn(() => "orders"),
  sendPushToUser: vi.fn(async () => {}),
}));
vi.mock("../../lib/brandthreadEmail", () => ({
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail: vi.fn(async () => {}),
  sendOrderShippingEmail: vi.fn(async () => true),
}));
vi.mock("../loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(),
  consumeLoyaltyRedemption: vi.fn(),
  releaseLoyaltyRedemption: vi.fn(),
  reversePurchasePointsOnce: vi.fn(),
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomUUID();
const sellerId = `cohesion-seller-${suffix}`;
const buyerId = `cohesion-buyer-${suffix}`;
const guestSessionId = `cs_cohesion_guest_${suffix}`;
const buyerSessionId = `cs_cohesion_buyer_${suffix}`;
const guestEmail = `guest-${suffix}@test.local`;
const checkoutIds: string[] = [];
let productId = "";
let variantId = "";
let server: Server;
let base = "";

function paidEvent(id: string, sessionId: string, csRef: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: 1_756_600_000,
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: `pi_${sessionId}`,
        amount_total: 3_700,
        total_details: { amount_discount: 0, amount_shipping: 1_200, amount_tax: 0 },
        metadata: { csRef },
      },
    },
  };
}

async function postWebhook() {
  return fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "test-signature" },
    body: "{}",
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Cohesion Seller", role: "seller", accountType: "seller" },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Jordan Reyes", role: "buyer", accountType: "buyer" },
  ]);
  const [product] = await db.insert(products).values({
    ownerId: sellerId, name: "Heavyweight Hoodie", category: "apparel", status: "active",
  }).returning({ id: products.id });
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId, sku: `cohesion-${suffix}`, priceCents: 2_500, stock: 10, lowStockThreshold: 10,
  }).returning({ id: productVariants.id });
  variantId = variant.id;

  const item = { variantId, productName: "Heavyweight Hoodie", variantLabel: "M", quantity: 1, priceCents: 2_500 };
  const address = { name: "Jordan Reyes", street: "1120 NW Everett St", city: "Portland", state: "OR", zip: "97209", country: "US" };
  const [buyerCheckout] = await db.insert(checkoutSessions).values({
    stripeSessionId: buyerSessionId, buyerId, sellerId, items: [item], shippingAddress: address,
  }).returning({ id: checkoutSessions.id });
  const [guestCheckout] = await db.insert(checkoutSessions).values({
    stripeSessionId: guestSessionId, guestEmail, sellerId, items: [item],
    shippingAddress: { ...address, name: "Guest Buyer" },
  }).returning({ id: checkoutSessions.id });
  checkoutIds.push(buyerCheckout.id, guestCheckout.id);

  const { default: webhookRouter } = await import("../webhooks");
  const { default: ordersRouter } = await import("../orders");
  const { default: buyerRouter } = await import("../buyer");
  const app = express();
  app.use("/api/webhooks", express.raw({ type: "application/json" }));
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api/webhooks", webhookRouter);
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  state.event = paidEvent(`evt_cohesion_buyer_${suffix}`, buyerSessionId, buyerCheckout.id);
  expect((await postWebhook()).status).toBe(200);
  state.event = paidEvent(`evt_cohesion_guest_${suffix}`, guestSessionId, guestCheckout.id);
  // Same variant, still at/below its low-stock threshold: this second order
  // used to hit notifications_feed_low_stock_unique inside the order
  // transaction and silently roll the whole paid order back.
  expect((await postWebhook()).status).toBe(200);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id IN (${`evt_cohesion_buyer_${suffix}`}, ${`evt_cohesion_guest_${suffix}`})`);
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
  const created = await db.select({ id: orders.id }).from(orders).where(eq(orders.ownerId, sellerId));
  if (created.length) {
    const ids = created.map((o) => o.id);
    await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await db.delete(orders).where(inArray(orders.id, ids)).catch(() => {});
  }
  await db.delete(checkoutSessions).where(inArray(checkoutSessions.id, checkoutIds));
  await db.delete(productVariants).where(eq(productVariants.id, variantId));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(inArray(users.clerkId, [buyerId, sellerId]));
});

describe("buyer checkout → seller orders cohesion", () => {
  it("seller and buyer read the same order: id, BT number, status, and a paid timestamp", async () => {
    const sellerRes = await fetch(`${base}/api/orders`, { headers: { "x-test-user": sellerId } });
    expect(sellerRes.status).toBe(200);
    const sellerRows: any[] = await sellerRes.json() as any;
    expect(sellerRows).toHaveLength(2);

    const buyerRes = await fetch(`${base}/api/buyer/orders`, { headers: { "x-test-user": buyerId } });
    expect(buyerRes.status).toBe(200);
    const buyerRows: any[] = await buyerRes.json() as any;
    expect(buyerRows).toHaveLength(1);

    const sellerView = sellerRows.find((row) => row.id === buyerRows[0].id);
    expect(sellerView).toBeTruthy();
    // Same number format and the same status enum on both sides.
    expect(sellerView.orderNumber).toMatch(/^BT-\d{5}$/);
    expect(sellerView.orderNumber).toBe(buyerRows[0].orderNumber);
    expect(sellerView.status).toBe("processing");
    expect(buyerRows[0].status).toBe(sellerView.status);
    // A paid checkout order carries its payment time to the seller list.
    expect(sellerView.paidAt).toBeTruthy();
    expect(sellerView.customerName).toBe("Jordan Reyes");
    expect(sellerView.customerEmail).toBe(`${buyerId}@test.local`);
    expect(sellerView.itemCount).toBe(1);
    expect(sellerView.totalCents).toBe(3_700);
  });

  it("names guest-checkout orders by the shipping name and checkout email", async () => {
    const rows: any[] = await (await fetch(`${base}/api/orders`, { headers: { "x-test-user": sellerId } })).json() as any;
    const guest = rows.find((row) => row.customerEmail === guestEmail);
    expect(guest).toBeTruthy();
    expect(guest.customerName).toBe("Guest Buyer");
    expect(guest.paidAt).toBeTruthy();
    expect(guest.orderNumber).toMatch(/^BT-\d{5}$/);
  });

  it("sends the seller one new-order notification per order, deep-linked to that order id", async () => {
    const rows: any[] = await (await fetch(`${base}/api/orders`, { headers: { "x-test-user": sellerId } })).json() as any;
    const alerts = await db
      .select({ targetId: notificationsFeed.targetId, targetType: notificationsFeed.targetType, body: notificationsFeed.body })
      .from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, sellerId), eq(notificationsFeed.type, "new_order_received")));
    expect(alerts).toHaveLength(2);
    for (const row of rows) {
      const alert = alerts.find((a) => a.targetId === row.id);
      expect(alert?.targetType).toBe("order");
      expect(alert?.body).toContain(row.orderNumber);
    }
  });

  it("the seller's order detail is the same row", async () => {
    const rows: any[] = await (await fetch(`${base}/api/orders`, { headers: { "x-test-user": sellerId } })).json() as any;
    const detail: any = await (await fetch(`${base}/api/orders/${rows[0].id}`, { headers: { "x-test-user": sellerId } })).json() as any;
    expect(detail.orderNumber ?? detail.order?.orderNumber).toBe(rows[0].orderNumber);
  });
});
